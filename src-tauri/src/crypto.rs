// Verschlüsselungs-Kern (Issue #1, Phase 2). Reine Krypto + Keyfile-Verwaltung,
// frei von Tauri-Typen.
//
// Modell (Key-Wrapping):
//   - DEK: 32-Byte-Zufallsschlüssel, dient direkt als SQLCipher-Rohschlüssel
//     (PRAGMA key = "x'<hex>'"). Verlässt NIE die Rust-Seite.
//   - Die DEK wird ZWEIFACH gekapselt (XChaCha20-Poly1305):
//       * mit einem aus dem PASSWORT abgeleiteten Schlüssel (Argon2id)
//       * mit einem aus dem RECOVERY-CODE abgeleiteten Schlüssel (Argon2id)
//     -> Passwort ODER Recovery-Code entsperren. Passwort ändern = nur die
//     Passwort-Kapsel neu schreiben (kein Re-Encrypt der DB).
//   - Das Poly1305-Tag IST der Verifizierer: falscher Schlüssel -> Tag-Fehler
//     -> "falsches Passwort", klar getrennt von einem echten DB-Fehler.
//
// Die keyfile.json (v2) enthält NUR öffentliches Wrapping-Material (Salts,
// Nonces, gekapselte DEK, KDF-Parameter) – nie DEK, Passwort oder Recovery-Code.

use std::path::Path;

use argon2::{Algorithm, Argon2, Params, Version};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand_core::{OsRng, RngCore};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

pub const KEYFILE_NAME: &str = "keyfile.json";
const DEK_LEN: usize = 32;
const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 24;
const RECOVERY_GROUPS: usize = 4;
const RECOVERY_GROUP_LEN: usize = 6;
// 32-Zeichen-Alphabet (A–Z ohne I/O, plus 2–9) = exakt 2^5 -> Maskierung der
// unteren 5 Bits ist gleichverteilt (keine Modulo-Verzerrung).
const RECOVERY_ALPHABET: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const DEFAULT_AUTOLOCK_MIN: u32 = 5;

// ---------- Keyfile-Schema (v2) ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct Kdf {
    pub alg: String, // "argon2id"
    pub v: u32,      // 19
    pub m: u32,      // KiB
    pub t: u32,
    pub p: u32,
}

impl Default for Kdf {
    fn default() -> Self {
        // OWASP/RFC-9106-Basiswerte für interaktives Entsperren.
        Kdf {
            alg: "argon2id".into(),
            v: 0x13,
            m: 65536, // 64 MiB
            t: 3,
            p: 1,
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Wrap {
    pub salt: String,    // hex, 16 B (Argon2-Salt für den KEK)
    pub nonce: String,   // hex, 24 B (XChaCha20-Nonce)
    pub wrapped: String, // hex, 48 B (32 B Ciphertext + 16 B Tag)
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeyfileV2 {
    pub version: u32, // == 2
    pub auto_lock_minutes: u32,
    pub kdf: Kdf,
    pub wrap_algo: String, // "xchacha20poly1305"
    pub pw: Wrap,
    pub rc: Wrap,
}

/// Zustand der keyfile.json, für die Startentscheidung (db_status).
pub enum KeyfileState {
    None,                                          // keine Datei -> Erst-Einrichtung
    V1 { auto_lock_minutes: u32 },                 // Phase-1-Keyfile -> Migration nötig
    V2(KeyfileV2),                                 // verschlüsselt
    Corrupt(String),                               // vorhanden, aber unlesbar
}

// ---------- Zufall / DEK / Recovery-Code ----------

fn fill_random(buf: &mut [u8]) {
    OsRng.fill_bytes(buf);
}

pub fn gen_dek() -> Zeroizing<[u8; DEK_LEN]> {
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    fill_random(&mut dek[..]);
    dek
}

/// Kanonischer Recovery-Code: 24 Zeichen ohne Trenner.
pub fn gen_recovery_canonical() -> Zeroizing<String> {
    let n = RECOVERY_GROUPS * RECOVERY_GROUP_LEN;
    let mut raw = Zeroizing::new(vec![0u8; n]);
    fill_random(&mut raw[..]);
    let s: String = raw
        .iter()
        .map(|b| RECOVERY_ALPHABET[(b & 0x1f) as usize] as char)
        .collect();
    Zeroizing::new(s)
}

/// Anzeigeform mit 6er-Gruppen (z. B. K7QF2M-9XR4TD-H3WPNB-6CYE8A).
pub fn format_recovery(canonical: &str) -> String {
    canonical
        .as_bytes()
        .chunks(RECOVERY_GROUP_LEN)
        .map(|c| std::str::from_utf8(c).unwrap_or(""))
        .collect::<Vec<_>>()
        .join("-")
}

/// Eingabe normalisieren: nur A–Z/0–9, Großbuchstaben (Trenner/Spaces raus).
pub fn normalize_recovery(input: &str) -> String {
    input
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_uppercase())
        .collect()
}

// ---------- Passwort-Policy ----------

/// Mindest-Policy fürs Passwort (Setup/Migration/Passwort-Änderung). Muss mit
/// validatePasswordPolicy (src/lib/auth.ts) übereinstimmen – zwei unabhängige
/// Durchsetzungsstellen (Frontend UND Rust-Command), damit ein IPC-Aufruf am
/// Frontend vorbei (oder ein UI-Bug) die Regel nicht umgehen kann.
pub fn validate_password_policy(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("Das Passwort muss mindestens 8 Zeichen lang sein.".to_string());
    }
    Ok(())
}

// ---------- KDF + AEAD-Wrapping ----------

fn build_aad(domain: &[u8], kdf: &Kdf) -> Vec<u8> {
    // Domain + KDF-Parameter binden -> ein heimliches Herabstufen der KDF
    // (Editieren der keyfile.json) lässt das Poly1305-Tag fehlschlagen.
    let mut aad = domain.to_vec();
    aad.extend_from_slice(
        format!("|{}|v={}|m={}|t={}|p={}", kdf.alg, kdf.v, kdf.m, kdf.t, kdf.p).as_bytes(),
    );
    aad
}

fn derive_kek(secret: &[u8], salt: &[u8], kdf: &Kdf) -> Result<Zeroizing<[u8; 32]>, String> {
    let params = Params::new(kdf.m, kdf.t, kdf.p, Some(32))
        .map_err(|e| format!("KDF-Parameter ungültig: {e}"))?;
    let argon = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);
    let mut kek = Zeroizing::new([0u8; 32]);
    argon
        .hash_password_into(secret, salt, &mut kek[..])
        .map_err(|e| format!("Schlüsselableitung fehlgeschlagen: {e}"))?;
    Ok(kek)
}

/// Fehler beim Entkapseln – sauber getrennt: falsches Geheimnis vs. Defekt.
#[derive(Debug)]
pub enum UnwrapError {
    WrongSecret,
    Corrupt(String),
}

fn wrap_dek(dek: &[u8; 32], secret: &[u8], domain: &[u8], kdf: &Kdf) -> Result<Wrap, String> {
    let mut salt = [0u8; SALT_LEN];
    fill_random(&mut salt);
    let kek = derive_kek(secret, &salt, kdf)?;
    let mut nonce = [0u8; NONCE_LEN];
    fill_random(&mut nonce);
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&kek[..]));
    let aad = build_aad(domain, kdf);
    let wrapped = cipher
        .encrypt(XNonce::from_slice(&nonce), Payload { msg: &dek[..], aad: &aad })
        .map_err(|_| "Kapseln der DEK fehlgeschlagen".to_string())?;
    Ok(Wrap {
        salt: hex::encode(salt),
        nonce: hex::encode(nonce),
        wrapped: hex::encode(wrapped),
    })
}

fn unwrap_dek(
    w: &Wrap,
    secret: &[u8],
    domain: &[u8],
    kdf: &Kdf,
) -> Result<Zeroizing<[u8; 32]>, UnwrapError> {
    let salt = hex::decode(&w.salt).map_err(|e| UnwrapError::Corrupt(e.to_string()))?;
    let nonce = hex::decode(&w.nonce).map_err(|e| UnwrapError::Corrupt(e.to_string()))?;
    let wrapped = hex::decode(&w.wrapped).map_err(|e| UnwrapError::Corrupt(e.to_string()))?;
    if nonce.len() != NONCE_LEN {
        return Err(UnwrapError::Corrupt("Nonce-Länge".into()));
    }
    let kek = derive_kek(secret, &salt, kdf).map_err(UnwrapError::Corrupt)?;
    let cipher = XChaCha20Poly1305::new(Key::from_slice(&kek[..]));
    let aad = build_aad(domain, kdf);
    // In Zeroizing heben: pt enthaelt die entschluesselte Klartext-DEK. Ohne
    // das wird der Vec<u8> beim Verlassen der Funktion (Rueckgabe, frueher
    // Return oder Fehlerpfad) normal gedroppt und NICHT ueberschrieben --
    // die DEK bliebe als Speicherabbild-Artefakt im Prozessspeicher zurueck.
    let pt = Zeroizing::new(
        cipher
            .decrypt(XNonce::from_slice(&nonce), Payload { msg: &wrapped, aad: &aad })
            // Tag-Fehler = falsches Geheimnis (oder manipulierte Parameter).
            .map_err(|_| UnwrapError::WrongSecret)?,
    );
    if pt.len() != DEK_LEN {
        return Err(UnwrapError::Corrupt("DEK-Länge".into()));
    }
    let mut dek = Zeroizing::new([0u8; DEK_LEN]);
    dek.copy_from_slice(&pt);
    Ok(dek)
}

const DOMAIN_PW: &[u8] = b"br-log/keyfile/v2/pw";
const DOMAIN_RC: &[u8] = b"br-log/keyfile/v2/rc";

/// Baut eine frische keyfile.json v2: DEK wird mit Passwort UND Recovery-Code
/// gekapselt. `recovery_canonical` ist die 24-Zeichen-Form ohne Trenner.
pub fn build_keyfile(
    dek: &[u8; 32],
    password: &str,
    recovery_canonical: &str,
    auto_lock_minutes: u32,
) -> Result<KeyfileV2, String> {
    let kdf = Kdf::default();
    let pw = wrap_dek(dek, password.as_bytes(), DOMAIN_PW, &kdf)?;
    let rc = wrap_dek(dek, recovery_canonical.as_bytes(), DOMAIN_RC, &kdf)?;
    Ok(KeyfileV2 {
        version: 2,
        auto_lock_minutes,
        kdf,
        wrap_algo: "xchacha20poly1305".into(),
        pw,
        rc,
    })
}

/// Entkapselt die DEK aus einer keyfile.json v2 mit Passwort.
pub fn unwrap_with_password(kf: &KeyfileV2, password: &str) -> Result<Zeroizing<[u8; 32]>, UnwrapError> {
    unwrap_dek(&kf.pw, password.as_bytes(), DOMAIN_PW, &kf.kdf)
}

/// Entkapselt die DEK mit einem (bereits normalisierten) Recovery-Code.
pub fn unwrap_with_recovery(
    kf: &KeyfileV2,
    recovery_canonical: &str,
) -> Result<Zeroizing<[u8; 32]>, UnwrapError> {
    unwrap_dek(&kf.rc, recovery_canonical.as_bytes(), DOMAIN_RC, &kf.kdf)
}

/// Kapselt die Passwort-Hülle einer bestehenden DEK neu (Passwort ändern).
pub fn rewrap_password(kf: &mut KeyfileV2, dek: &[u8; 32], new_password: &str) -> Result<(), String> {
    kf.pw = wrap_dek(dek, new_password.as_bytes(), DOMAIN_PW, &kf.kdf)?;
    Ok(())
}

/// Kapselt die Recovery-Hülle einer bestehenden DEK neu (Code neu erzeugen).
pub fn rewrap_recovery(
    kf: &mut KeyfileV2,
    dek: &[u8; 32],
    new_recovery_canonical: &str,
) -> Result<(), String> {
    kf.rc = wrap_dek(dek, new_recovery_canonical.as_bytes(), DOMAIN_RC, &kf.kdf)?;
    Ok(())
}

/// DEK als SQLCipher-Rohschlüssel-Literal: x'<64 hex>'.
pub fn dek_pragma_literal(dek: &[u8; 32]) -> Zeroizing<String> {
    Zeroizing::new(format!("x'{}'", hex::encode(dek)))
}

// ---------- Keyfile-IO ----------

pub fn classify_keyfile(data_dir: &Path) -> KeyfileState {
    let path = data_dir.join(KEYFILE_NAME);
    let raw = match std::fs::read_to_string(&path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return KeyfileState::None,
        Err(e) => return KeyfileState::Corrupt(e.to_string()),
        Ok(s) => s,
    };
    let trimmed = raw.trim_start_matches('\u{feff}');
    let val: serde_json::Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(e) => return KeyfileState::Corrupt(format!("JSON: {e}")),
    };
    match val.get("version").and_then(|v| v.as_u64()) {
        Some(2) => match serde_json::from_str::<KeyfileV2>(trimmed) {
            Ok(kf) => KeyfileState::V2(kf),
            Err(e) => KeyfileState::Corrupt(format!("v2: {e}")),
        },
        Some(1) => KeyfileState::V1 {
            auto_lock_minutes: val
                .get("autoLockMinutes")
                .and_then(|v| v.as_u64())
                .map(|n| n as u32)
                .unwrap_or(DEFAULT_AUTOLOCK_MIN),
        },
        _ => KeyfileState::Corrupt("unbekannte Keyfile-Version".into()),
    }
}

/// Schreibt die keyfile.json v2 ATOMAR (temp + rename) -> keine halbe Datei.
pub fn write_keyfile_atomic(data_dir: &Path, kf: &KeyfileV2) -> Result<(), String> {
    let path = data_dir.join(KEYFILE_NAME);
    let tmp = data_dir.join(format!("{KEYFILE_NAME}.tmp"));
    let json = serde_json::to_string_pretty(kf).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json)
        .map_err(|e| format!("Keyfile nicht schreibbar ({}): {e}", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("Keyfile nicht ersetzbar ({}): {e}", path.display()))
}

// ---------- Tests (bewusst Tauri-frei, siehe Modul-Kommentar oben) ----------

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU32, Ordering};

    /// Eindeutiges, isoliertes Verzeichnis unter dem System-Temp-Ordner für
    /// Dateisystem-Tests (Keyfile-IO). Aufräumen übernimmt der Aufrufer.
    fn temp_test_dir(label: &str) -> std::path::PathBuf {
        static COUNTER: AtomicU32 = AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "br-log-crypto-test-{label}-{}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).expect("Temp-Testverzeichnis anlegen");
        dir
    }

    #[test]
    fn wrap_unwrap_roundtrip_password_und_recovery() {
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let kf = build_keyfile(&dek, "mein-passwort", &recovery, 5).expect("build_keyfile");

        let dek_pw = unwrap_with_password(&kf, "mein-passwort").expect("unwrap mit Passwort");
        assert_eq!(&*dek_pw, &*dek);

        let dek_rc = unwrap_with_recovery(&kf, &recovery).expect("unwrap mit Recovery-Code");
        assert_eq!(&*dek_rc, &*dek);
    }

    #[test]
    fn falsches_passwort_liefert_wrong_secret() {
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let kf = build_keyfile(&dek, "richtig", &recovery, 5).expect("build_keyfile");

        let err = unwrap_with_password(&kf, "falsch").unwrap_err();
        assert!(matches!(err, UnwrapError::WrongSecret));
    }

    #[test]
    fn falscher_recovery_code_liefert_wrong_secret() {
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let kf = build_keyfile(&dek, "pw", &recovery, 5).expect("build_keyfile");

        // 24 Zeichen (korrekte Länge), aber falscher Inhalt.
        let err = unwrap_with_recovery(&kf, "ZZZZZZZZZZZZZZZZZZZZZZZZ").unwrap_err();
        assert!(matches!(err, UnwrapError::WrongSecret));
    }

    #[test]
    fn recovery_code_format_24_zeichen_aus_dem_alphabet() {
        let recovery = gen_recovery_canonical();
        assert_eq!(recovery.len(), 24);
        assert!(recovery.bytes().all(|b| RECOVERY_ALPHABET.contains(&b)));

        let display = format_recovery(&recovery);
        // 4 Gruppen a 6 Zeichen mit 3 Bindestrichen -> 27 Zeichen Anzeigeform.
        assert_eq!(display.len(), 27);
        assert_eq!(display.matches('-').count(), 3);
        // Normalisieren der Anzeigeform muss wieder die kanonische Form ergeben.
        assert_eq!(normalize_recovery(&display), *recovery);
    }

    #[test]
    fn recovery_alphabet_schliesst_verwechselbare_zeichen_aus() {
        // I, O, 0, 1 sind absichtlich nicht im Alphabet (Verwechslungsgefahr).
        for c in [b'I', b'O', b'0', b'1'] {
            assert!(!RECOVERY_ALPHABET.contains(&c));
        }
    }

    #[test]
    fn manipulierte_kdf_parameter_werden_durch_aad_erkannt() {
        // AAD bindet die KDF-Parameter -> ein nachträglich verändertes m/t/p
        // (z. B. durch Editieren der keyfile.json) lässt die Poly1305-Prüfung
        // fehlschlagen, obwohl das Passwort korrekt ist.
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let mut kf = build_keyfile(&dek, "pw", &recovery, 5).expect("build_keyfile");
        kf.kdf.t += 1; // KDF-Parameter nachträglich manipuliert

        let err = unwrap_with_password(&kf, "pw").unwrap_err();
        assert!(matches!(err, UnwrapError::WrongSecret));
    }

    #[test]
    fn manipulierter_ciphertext_wird_erkannt() {
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let mut kf = build_keyfile(&dek, "pw", &recovery, 5).expect("build_keyfile");
        // Ein Byte im gekapselten Ciphertext kippen -> Tag-Prüfung schlägt fehl.
        let mut bytes = hex::decode(&kf.pw.wrapped).unwrap();
        bytes[0] ^= 0xff;
        kf.pw.wrapped = hex::encode(bytes);

        let err = unwrap_with_password(&kf, "pw").unwrap_err();
        assert!(matches!(err, UnwrapError::WrongSecret));
    }

    #[test]
    fn passwort_wechsel_erhaelt_recovery_code_und_ersetzt_altes_passwort() {
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let mut kf = build_keyfile(&dek, "alt", &recovery, 5).expect("build_keyfile");

        rewrap_password(&mut kf, &dek, "neu").expect("rewrap_password");

        assert!(matches!(
            unwrap_with_password(&kf, "alt"),
            Err(UnwrapError::WrongSecret)
        ));
        let dek2 = unwrap_with_password(&kf, "neu").expect("neues Passwort muss funktionieren");
        assert_eq!(&*dek2, &*dek);
        // Recovery-Code bleibt unverändert gültig (kein Re-Wrap nötig).
        let dek3 = unwrap_with_recovery(&kf, &recovery).expect("Recovery bleibt gültig");
        assert_eq!(&*dek3, &*dek);
    }

    #[test]
    fn neuer_recovery_code_macht_den_alten_ungueltig() {
        let dek = gen_dek();
        let old_recovery = gen_recovery_canonical();
        let mut kf = build_keyfile(&dek, "pw", &old_recovery, 5).expect("build_keyfile");

        let new_recovery = gen_recovery_canonical();
        rewrap_recovery(&mut kf, &dek, &new_recovery).expect("rewrap_recovery");

        assert!(matches!(
            unwrap_with_recovery(&kf, &old_recovery),
            Err(UnwrapError::WrongSecret)
        ));
        let dek2 = unwrap_with_recovery(&kf, &new_recovery).expect("neuer Code muss funktionieren");
        assert_eq!(&*dek2, &*dek);
    }

    #[test]
    fn dek_pragma_literal_ist_x_gequotetes_hex() {
        let dek = gen_dek();
        let literal = dek_pragma_literal(&dek);
        assert!(literal.starts_with("x'"));
        assert!(literal.ends_with('\''));
        assert_eq!(literal.len(), 2 + 64 + 1); // x' + 64 Hex-Zeichen (32 B) + '
    }

    #[test]
    fn normalize_recovery_entfernt_trenner_und_grossschreibt() {
        assert_eq!(normalize_recovery("ab12-cd34"), "AB12CD34");
        assert_eq!(normalize_recovery(" a b c "), "ABC");
    }

    #[test]
    fn validate_password_policy_lehnt_zu_kurzes_passwort_ab() {
        let err = validate_password_policy("1234567").unwrap_err();
        assert!(err.contains("mindestens 8 Zeichen"));
    }

    #[test]
    fn validate_password_policy_akzeptiert_acht_zeichen() {
        assert!(validate_password_policy("12345678").is_ok());
    }

    #[test]
    fn validate_password_policy_akzeptiert_laengeres_passwort() {
        assert!(validate_password_policy("ein-ziemlich-langes-passwort").is_ok());
    }

    #[test]
    fn validate_password_policy_zaehlt_unicode_zeichen_nicht_bytes() {
        // 8 Zeichen, aber mehr als 8 Bytes (Umlaute sind 2 Byte in UTF-8) ->
        // muss dennoch als ausreichend lang gelten (Zeichen zählen, nicht Bytes).
        let pw = "äöüäöüäö";
        assert_eq!(pw.chars().count(), 8);
        assert!(validate_password_policy(pw).is_ok());
    }

    #[test]
    fn classify_keyfile_none_wenn_keine_datei_vorhanden() {
        let dir = temp_test_dir("none");
        assert!(matches!(classify_keyfile(&dir), KeyfileState::None));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn classify_keyfile_corrupt_bei_kaputtem_json() {
        let dir = temp_test_dir("corrupt");
        std::fs::write(dir.join(KEYFILE_NAME), "{ das ist kein json").unwrap();
        assert!(matches!(classify_keyfile(&dir), KeyfileState::Corrupt(_)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_keyfile_atomic_roundtrip_ueber_classify() {
        let dek = gen_dek();
        let recovery = gen_recovery_canonical();
        let kf = build_keyfile(&dek, "pw", &recovery, 7).expect("build_keyfile");

        let dir = temp_test_dir("roundtrip");
        write_keyfile_atomic(&dir, &kf).expect("write_keyfile_atomic");

        match classify_keyfile(&dir) {
            KeyfileState::V2(loaded) => {
                assert_eq!(loaded.auto_lock_minutes, 7);
                let dek2 = unwrap_with_password(&loaded, "pw").expect("unwrap nach Reload");
                assert_eq!(&*dek2, &*dek);
            }
            _ => panic!("erwartet KeyfileState::V2 nach write_keyfile_atomic"),
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
