use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

// Must match packages/happy-client/src/auth/credentials.ts exactly — both
// read/write the same macOS Keychain item so a device linked once (via the
// happy-client verification scripts) is usable from ccdeck without
// re-linking.
const KEYCHAIN_SERVICE: &str = "ccdeck-happy-account";
const KEYCHAIN_ACCOUNT: &str = "default";

#[derive(Debug, Serialize, Deserialize)]
struct StoredCredentials {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    token: String,
    secret: String,
}

/// Reads the Happy account credentials from the macOS Keychain. Returns
/// `None` (not an error) when no device has been linked yet.
#[tauri::command]
fn get_credentials() -> Result<Option<StoredCredentials>, String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(raw) => serde_json::from_str(&raw)
            .map(Some)
            .map_err(|e| format!("Stored Happy credentials are malformed: {e}")),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[derive(Debug, Deserialize)]
struct HappyCliSettings {
    #[serde(rename = "machineId")]
    machine_id: Option<String>,
}

/// This machine's Happy `machineId`, read from the same `~/.happy/settings.json`
/// the `happy` CLI writes — lets ccdeck identify "this machine"'s own
/// sessions among everything the account can see.
#[tauri::command]
fn get_local_machine_id() -> Result<Option<String>, String> {
    let home = std::env::var("HOME").map_err(|e| e.to_string())?;
    let path = PathBuf::from(home).join(".happy").join("settings.json");
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    let settings: HappyCliSettings = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
    Ok(settings.machine_id)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![get_credentials, get_local_machine_id])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
