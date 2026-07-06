// Plugin-Fehlertyp. Der springende Punkt gegenueber einem simplen String: der
// vom Kotlin-Teil per invoke.reject(msg, code) mitgegebene Fehler-CODE bleibt
// erhalten. Die App (bio_unlock) verzweigt darauf -- insbesondere KEY_INVALIDATED
// (neuer Finger registriert -> Keystore-Key ungueltig) loest ein Entfernen des
// bio-Wraps aus. Ohne den durchgereichten Code liesse sich dieser Zustand nicht
// vom gewoehnlichen Abbruch unterscheiden.

use std::fmt;

pub type Result<T> = std::result::Result<T, Error>;

/// Bekannte Fehlercodes des Kotlin-Teils (siehe BiometricUnlockPlugin.kt).
pub mod code {
    pub const USER_CANCELED: &str = "USER_CANCELED";
    pub const LOCKOUT: &str = "LOCKOUT";
    pub const KEY_INVALIDATED: &str = "KEY_INVALIDATED";
    pub const NO_BIOMETRICS: &str = "NO_BIOMETRICS";
    pub const OTHER: &str = "OTHER";
}

#[derive(Debug)]
pub enum Error {
    /// Vom Kotlin-Teil abgelehnter Aufruf (traegt Code + Meldung).
    Rejected { code: Option<String>, message: String },
    /// Serialisierungs-/Deserialisierungsfehler des IPC-Payloads.
    Serde(String),
    /// Nicht-Android-Aufruf bzw. Plugin nicht verfuegbar.
    Unsupported,
}

impl Error {
    /// Der vom Kotlin-Teil gelieferte Fehlercode, falls vorhanden.
    pub fn code(&self) -> Option<&str> {
        match self {
            Error::Rejected { code, .. } => code.as_deref(),
            _ => None,
        }
    }

    /// Menschliche (deutsche) Meldung zum Weiterreichen an die UI.
    pub fn message(&self) -> String {
        match self {
            Error::Rejected { message, .. } => message.clone(),
            Error::Serde(m) => format!("Datenformatfehler: {m}"),
            Error::Unsupported => {
                "Fingerabdruck-Entsperren ist auf dieser Plattform nicht verfügbar.".to_string()
            }
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Error::Rejected { code: Some(code), message } => write!(f, "[{code}] {message}"),
            Error::Rejected { code: None, message } => write!(f, "{message}"),
            Error::Serde(m) => write!(f, "Datenformatfehler: {m}"),
            Error::Unsupported => write!(f, "Plugin auf dieser Plattform nicht verfügbar"),
        }
    }
}

impl std::error::Error for Error {}

impl serde::Serialize for Error {
    fn serialize<S>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

// Wandelt den generischen Tauri-Mobile-Invoke-Fehler in unseren Typ und rettet
// dabei den Fehlercode aus der Kotlin-Rejection (ErrorResponse.code).
#[cfg(mobile)]
impl From<tauri::plugin::mobile::PluginInvokeError> for Error {
    fn from(e: tauri::plugin::mobile::PluginInvokeError) -> Self {
        use tauri::plugin::mobile::PluginInvokeError;
        match e {
            PluginInvokeError::InvokeRejected(resp) => Error::Rejected {
                code: resp.code.clone(),
                message: resp
                    .message
                    .clone()
                    .unwrap_or_else(|| "Fingerabdruck-Vorgang fehlgeschlagen.".to_string()),
            },
            // Kein strukturierter Code (JNI-/Webview-/Serde-Fehler) -> OTHER.
            other => Error::Rejected {
                code: Some(code::OTHER.to_string()),
                message: other.to_string(),
            },
        }
    }
}
