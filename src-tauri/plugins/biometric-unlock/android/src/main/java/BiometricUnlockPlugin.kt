// BR-Log Biometrie-Entsperren -- Kotlin-Teil des projektinternen Tauri-Plugins
// (Issue #2). Sicherheitskern: ein AES-256-GCM-Schluessel im Android-Keystore
// (auth-required, invalidatedByBiometricEnrollment, StrongBox best effort) kapselt
// die DEK. Ent-/Verschluesselt wird NUR nach erfolgreichem BiometricPrompt mit
// CryptoObject-Bindung -- die Biometrie autorisiert genau die eine Cipher-Instanz.
//
// Die DEK ueberquert die JNI-Grenze als Base64 (android.util.Base64.NO_WRAP ==
// Rust base64 STANDARD). ByteArrays mit Schluesselmaterial werden nach Gebrauch
// best effort mit Nullen ueberschrieben -- auf der JVM keine harte Garantie (GC
// kann Kopien anlegen), aber es minimiert die Verweildauer im Heap.

package de.betriebsrat.brzeiten.biometric

import android.app.Activity
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.security.KeyStore
import java.util.Arrays
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@InvokeArg
internal class EnrollArgs {
    lateinit var dekB64: String
}

@InvokeArg
internal class AuthenticateArgs {
    lateinit var ciphertextB64: String
    lateinit var ivB64: String
}

@TauriPlugin
class BiometricUnlockPlugin(private val activity: Activity) : Plugin(activity) {

    companion object {
        private const val KEY_ALIAS = "br_log_bio_dek"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private const val B64 = Base64.NO_WRAP

        // Deutsche Prompt-Texte laut Sicherheitsdesign.
        private const val PROMPT_TITLE = "BR-Log entsperren"
        private const val PROMPT_NEGATIVE = "Passwort verwenden"
    }

    // ---------- Command: isAvailable ----------

    @Command
    fun isAvailable(invoke: Invoke) {
        val result = BiometricManager.from(activity)
            .canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
        val obj = JSObject()
        if (result == BiometricManager.BIOMETRIC_SUCCESS) {
            obj.put("available", true)
        } else {
            obj.put("available", false)
            obj.put("reason", availabilityReason(result))
        }
        invoke.resolve(obj)
    }

    // ---------- Command: enroll ----------

    @Command
    fun enroll(invoke: Invoke) {
        val args = invoke.parseArgs(EnrollArgs::class.java)
        val dek = try {
            Base64.decode(args.dekB64, B64)
        } catch (e: Exception) {
            invoke.reject("Ungültige DEK-Daten.", "OTHER", e)
            return
        }

        val cipher: Cipher
        try {
            val key = generateKey() // ersetzt einen vorhandenen Schluessel
            cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key)
        } catch (e: Exception) {
            zero(dek)
            invoke.reject("Schlüssel konnte nicht erstellt werden: ${e.message}", "OTHER", e)
            return
        }

        showPrompt(
            cipher = cipher,
            subtitle = "Fingerabdruck zum Aktivieren bestätigen",
            invoke = invoke,
            onAbort = { zero(dek) }, // Review-Finding: DEK auch bei Abbruch nullen
        ) { authorizedCipher ->
            val ct = authorizedCipher.doFinal(dek)
            zero(dek)
            val out = JSObject()
            out.put("ciphertextB64", Base64.encodeToString(ct, B64))
            out.put("ivB64", Base64.encodeToString(authorizedCipher.iv, B64))
            invoke.resolve(out)
        }
    }

    // ---------- Command: authenticate ----------

    @Command
    fun authenticate(invoke: Invoke) {
        val args = invoke.parseArgs(AuthenticateArgs::class.java)
        val ciphertext: ByteArray
        val iv: ByteArray
        try {
            ciphertext = Base64.decode(args.ciphertextB64, B64)
            iv = Base64.decode(args.ivB64, B64)
        } catch (e: Exception) {
            invoke.reject("Ungültige bio-Wrap-Daten.", "OTHER", e)
            return
        }

        val cipher: Cipher
        try {
            val key = loadKey()
            if (key == null) {
                // Kein Schluessel -> wie ungueltig behandeln, damit die App den
                // bio-Wrap verwirft und auf Passwort zurueckfaellt.
                invoke.reject("Kein Fingerabdruck-Schlüssel vorhanden.", "KEY_INVALIDATED")
                return
            }
            cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        } catch (e: KeyPermanentlyInvalidatedException) {
            // Neuer Finger registriert -> Keystore-Key invalidiert.
            invoke.reject("Fingerabdruck-Schlüssel ungültig (neue Biometrie registriert).", "KEY_INVALIDATED", e)
            return
        } catch (e: Exception) {
            invoke.reject("Entschlüsselung konnte nicht vorbereitet werden: ${e.message}", "OTHER", e)
            return
        }

        showPrompt(
            cipher = cipher,
            subtitle = "Mit Fingerabdruck entsperren",
            invoke = invoke,
        ) { authorizedCipher ->
            val pt = authorizedCipher.doFinal(ciphertext)
            val b64 = Base64.encodeToString(pt, B64)
            zero(pt)
            val out = JSObject()
            out.put("dekB64", b64)
            invoke.resolve(out)
        }
    }

    // ---------- Command: removeKey ----------

    @Command
    fun removeKey(invoke: Invoke) {
        try {
            val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
            if (ks.containsAlias(KEY_ALIAS)) {
                ks.deleteEntry(KEY_ALIAS)
            }
            invoke.resolve()
        } catch (e: Exception) {
            invoke.reject("Schlüssel konnte nicht entfernt werden: ${e.message}", "OTHER", e)
        }
    }

    // ---------- BiometricPrompt ----------

    /**
     * Zeigt den (Crypto-gebundenen) BiometricPrompt auf dem UI-Thread. `onSuccess`
     * bekommt den durch die Authentifizierung autorisierten Cipher und fuehrt die
     * eigentliche Kryptografie aus (doFinal). Fehler/Abbruch werden auf die
     * definierten Codes gemappt und per invoke.reject zurueckgegeben.
     */
    private fun showPrompt(
        cipher: Cipher,
        subtitle: String,
        invoke: Invoke,
        // Wird bei Abbruch/Fehler VOR dem reject gerufen, damit Aufrufer
        // sensible Puffer (DEK) auch im Nicht-Erfolgspfad nullen koennen.
        onAbort: (() -> Unit)? = null,
        onSuccess: (Cipher) -> Unit,
    ) {
        activity.runOnUiThread {
            try {
                val fragmentActivity = activity as FragmentActivity
                val executor = ContextCompat.getMainExecutor(activity)
                val prompt = BiometricPrompt(
                    fragmentActivity,
                    executor,
                    object : BiometricPrompt.AuthenticationCallback() {
                        override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                            onAbort?.invoke()
                            invoke.reject(errString.toString(), mapError(errorCode))
                        }

                        override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                            val authorized = result.cryptoObject?.cipher
                            if (authorized == null) {
                                invoke.reject("Kein autorisierter Cipher nach der Authentifizierung.", "OTHER")
                                return
                            }
                            try {
                                onSuccess(authorized)
                            } catch (e: KeyPermanentlyInvalidatedException) {
                                invoke.reject("Fingerabdruck-Schlüssel ungültig (neue Biometrie registriert).", "KEY_INVALIDATED", e)
                            } catch (e: Exception) {
                                invoke.reject("Kryptografischer Vorgang fehlgeschlagen: ${e.message}", "OTHER", e)
                            }
                        }

                        // Einzelner Fehlversuch (falscher Finger): Prompt bleibt offen,
                        // Android zaehlt selbst Richtung LOCKOUT. Nichts zu tun.
                        override fun onAuthenticationFailed() {}
                    },
                )

                val info = BiometricPrompt.PromptInfo.Builder()
                    .setTitle(PROMPT_TITLE)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText(PROMPT_NEGATIVE)
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build()

                prompt.authenticate(info, BiometricPrompt.CryptoObject(cipher))
            } catch (e: Exception) {
                onAbort?.invoke()
                invoke.reject("Biometrie-Dialog konnte nicht angezeigt werden: ${e.message}", "OTHER", e)
            }
        }
    }

    // ---------- Keystore ----------

    private fun loadKey(): SecretKey? {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        return ks.getKey(KEY_ALIAS, null) as? SecretKey
    }

    /**
     * Erzeugt einen frischen auth-pflichtigen AES-256-GCM-Schluessel und ersetzt
     * dabei einen evtl. vorhandenen. StrongBox wird bevorzugt, aber fallback-tolerant
     * (nicht jedes Geraet hat ein Secure Element).
     */
    private fun generateKey(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        if (ks.containsAlias(KEY_ALIAS)) {
            ks.deleteEntry(KEY_ALIAS)
        }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                generator.init(buildKeySpec(strongBox = true))
                return generator.generateKey()
            } catch (e: StrongBoxUnavailableException) {
                // Kein StrongBox-Backing -> ohne erneut versuchen.
            } catch (e: Exception) {
                // Manche Geraete werfen generische Fehler statt StrongBoxUnavailable.
            }
        }
        generator.init(buildKeySpec(strongBox = false))
        return generator.generateKey()
    }

    private fun buildKeySpec(strongBox: Boolean): KeyGenParameterSpec {
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true)

        // Auth-pro-Nutzung strikt an eine biometrische Authentifizierung binden
        // (CryptoObject). API 30+ nutzt die neue Parameter-API, darunter -1s.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG)
        } else {
            @Suppress("DEPRECATION")
            builder.setUserAuthenticationValidityDurationSeconds(-1)
        }

        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            builder.setIsStrongBoxBacked(true)
        }
        return builder.build()
    }

    // ---------- Mapping / Helpers ----------

    private fun mapError(errorCode: Int): String = when (errorCode) {
        BiometricPrompt.ERROR_USER_CANCELED,
        BiometricPrompt.ERROR_NEGATIVE_BUTTON,
        BiometricPrompt.ERROR_CANCELED -> "USER_CANCELED"

        BiometricPrompt.ERROR_LOCKOUT,
        BiometricPrompt.ERROR_LOCKOUT_PERMANENT -> "LOCKOUT"

        BiometricPrompt.ERROR_NO_BIOMETRICS,
        BiometricPrompt.ERROR_HW_NOT_PRESENT,
        BiometricPrompt.ERROR_HW_UNAVAILABLE -> "NO_BIOMETRICS"

        else -> "OTHER"
    }

    private fun availabilityReason(result: Int): String = when (result) {
        BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE -> "Kein Fingerabdruck-Sensor vorhanden."
        BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE -> "Fingerabdruck-Sensor derzeit nicht verfügbar."
        BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED -> "Es ist kein Fingerabdruck registriert."
        BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED -> "Ein Sicherheitsupdate ist erforderlich."
        else -> "Fingerabdruck-Authentifizierung wird nicht unterstützt."
    }

    private fun zero(bytes: ByteArray) {
        Arrays.fill(bytes, 0.toByte())
    }
}
