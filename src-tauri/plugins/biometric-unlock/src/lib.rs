//! BR-Log Biometrie-Entsperren (Issue #2).
//!
//! Duenne Rust-Bruecke zum Kotlin-Teil (android/src/main/java/BiometricUnlockPlugin.kt).
//! Die eigentliche Sicherheitslogik lebt in Kotlin: ein AES-256-GCM-Schluessel im
//! Android-Keystore (auth-required, invalidatedByBiometricEnrollment) kapselt die
//! DEK; ent-/verschluesselt wird ausschliesslich nach erfolgreichem BiometricPrompt
//! mit CryptoObject-Bindung. Rust ruft nur, transportiert Base64-Strings und reicht
//! die Kotlin-Fehlercodes durch (siehe error.rs).

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

#[cfg(mobile)]
use tauri::plugin::PluginHandle;
#[cfg(mobile)]
use tauri::Manager;

mod error;
mod models;

pub use error::{code, Error, Result};
pub use models::*;

#[cfg(target_os = "android")]
const PLUGIN_IDENTIFIER: &str = "de.betriebsrat.brzeiten.biometric";

/// Zugriff auf die Biometrie-Entsperr-APIs (nur Mobile). Haelt den PluginHandle,
/// ueber den run_mobile_plugin in den Kotlin-Teil ruft.
#[cfg(mobile)]
pub struct BiometricUnlock<R: Runtime>(PluginHandle<R>);

#[cfg(mobile)]
impl<R: Runtime> BiometricUnlock<R> {
    /// Ob BIOMETRIC_STRONG auf dem Geraet nutzbar ist (+ Grund bei false).
    pub fn is_available(&self) -> Result<AvailabilityResponse> {
        self.0
            .run_mobile_plugin("isAvailable", ())
            .map_err(Into::into)
    }

    /// Erzeugt/ersetzt den Keystore-Key, zeigt den BiometricPrompt (Encrypt-Cipher)
    /// und liefert den AES-256-GCM-Wrap der uebergebenen DEK (Base64) zurueck.
    pub fn enroll(&self, dek_b64: String) -> Result<EnrollResponse> {
        self.0
            .run_mobile_plugin("enroll", EnrollRequest { dek_b64 })
            .map_err(Into::into)
    }

    /// Zeigt den BiometricPrompt (Decrypt-Cipher mit gespeicherter IV) und liefert
    /// bei Erfolg die entschluesselte DEK (Base64) zurueck. Fehlercodes siehe
    /// error::code (u. a. KEY_INVALIDATED bei neu registrierter Biometrie).
    pub fn authenticate(
        &self,
        ciphertext_b64: String,
        iv_b64: String,
    ) -> Result<AuthenticateResponse> {
        self.0
            .run_mobile_plugin(
                "authenticate",
                AuthenticateRequest {
                    ciphertext_b64,
                    iv_b64,
                },
            )
            .map_err(Into::into)
    }

    /// Loescht den Keystore-Eintrag (idempotent -- kein Fehler, wenn nicht vorhanden).
    pub fn remove_key(&self) -> Result<()> {
        self.0
            .run_mobile_plugin::<()>("removeKey", ())
            .map(|_| ())
            .map_err(Into::into)
    }

    /// Schaltet FLAG_SECURE zur Laufzeit um (Issue #17, Task 7). Der Default
    /// (FLAG_SECURE an) wird UNABHAENGIG davon in MainActivity.onCreate gesetzt
    /// (schuetzt ab dem ersten Frame) -- dieser Aufruf erlaubt nur das spaetere
    /// Abschalten laut Nutzereinstellung. Fachlich losgeloest von der
    /// Biometrie, haengt aber bewusst an diesem bereits registrierten Plugin
    /// (s. Kommentar in BiometricUnlockPlugin.kt) statt an einem eigenen
    /// zweiten Android-Plugin nur fuer einen Schalter.
    pub fn set_secure_screen(&self, enabled: bool) -> Result<()> {
        self.0
            .run_mobile_plugin::<()>("setSecureScreen", SetSecureScreenRequest { enabled })
            .map(|_| ())
            .map_err(Into::into)
    }
}

/// Erweiterung fuer Manager-Typen (App/AppHandle): `app.biometric_unlock()`.
#[cfg(mobile)]
pub trait BiometricUnlockExt<R: Runtime> {
    fn biometric_unlock(&self) -> &BiometricUnlock<R>;
}

#[cfg(mobile)]
impl<R: Runtime, T: Manager<R>> BiometricUnlockExt<R> for T {
    fn biometric_unlock(&self) -> &BiometricUnlock<R> {
        self.state::<BiometricUnlock<R>>().inner()
    }
}

/// Initialisiert das Plugin. Auf Android wird der Kotlin-Plugin registriert und der
/// Handle als State verwaltet; auf anderen Plattformen ist es ein No-Op (die App
/// registriert das Plugin ohnehin nur unter cfg(target_os = "android")).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("biometric-unlock")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    _api.register_android_plugin(PLUGIN_IDENTIFIER, "BiometricUnlockPlugin")?;
                _app.manage(BiometricUnlock(handle));
            }
            Ok(())
        })
        .build()
}
