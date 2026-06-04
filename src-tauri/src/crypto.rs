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
    let pt = cipher
        .decrypt(XNonce::from_slice(&nonce), Payload { msg: &wrapped, aad: &aad })
        // Tag-Fehler = falsches Geheimnis (oder manipulierte Parameter).
        .map_err(|_| UnwrapError::WrongSecret)?;
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
