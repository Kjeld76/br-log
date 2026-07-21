// Request-/Response-Vertraege zwischen Rust und dem Kotlin-Plugin. serde
// camelCase spiegelt die Kotlin-@InvokeArg-Felder bzw. die von Kotlin per
// invoke.resolve zurueckgegebenen JSObject-Schluessel:
//   dek_b64        <-> dekB64
//   ciphertext_b64 <-> ciphertextB64
//   iv_b64         <-> ivB64
//
// Alle Base64-Werte nutzen das Standard-Alphabet MIT Padding und OHNE Zeilenumbrueche
// (Rust: base64 STANDARD, Kotlin: android.util.Base64.NO_WRAP) -- beide Seiten sind
// dadurch bit-identisch. Nur die DEK ueberquert die Grenze in BEIDE Richtungen und
// wird auf beiden Seiten de-/kodiert; ciphertext/iv sind fuer Rust opak (nur Kotlin
// erzeugt und liest sie wieder).

use serde::{Deserialize, Serialize};

/// enroll-Argument: die zu kapselnde DEK (Base64).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollRequest {
    pub dek_b64: String,
}

/// enroll-Ergebnis: von Android erzeugter AES-256-GCM-Ciphertext der DEK plus
/// zugehoerige IV (beide Base64). Landen unveraendert als bio-Wrap im keyfile.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnrollResponse {
    pub ciphertext_b64: String,
    pub iv_b64: String,
}

/// authenticate-Argument: der gespeicherte bio-Wrap (Ciphertext + IV, Base64).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateRequest {
    pub ciphertext_b64: String,
    pub iv_b64: String,
}

/// authenticate-Ergebnis: die entschluesselte DEK (Base64) nach erfolgreicher
/// Biometrie-Authentifizierung.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticateResponse {
    pub dek_b64: String,
}

/// isAvailable-Ergebnis: ob BIOMETRIC_STRONG nutzbar ist; `reason` traegt bei
/// `available == false` einen kurzen Grund (z. B. kein Sensor, nichts registriert).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityResponse {
    pub available: bool,
    #[serde(default)]
    pub reason: Option<String>,
}

/// setSecureScreen-Argument (Issue #17, Task 7): FLAG_SECURE zur Laufzeit
/// ein-/ausschalten. Fachlich unabhaengig von der Biometrie, haengt aber
/// bewusst an diesem bereits registrierten Plugin (s. Kommentar bei
/// BiometricUnlockPlugin.setSecureScreen) statt an einem zweiten Android-Plugin.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSecureScreenRequest {
    pub enabled: bool,
}
