use keyring::{Entry, Error as KeyringError};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

mod claude_usage;
mod notification;

#[cfg(target_os = "macos")]
mod macos_titlebar;

#[cfg(target_os = "windows")]
mod win_clipboard;

#[cfg(target_os = "windows")]
mod win_webview;

struct TitlebarHeight(std::sync::Mutex<Option<f64>>);

// Must match packages/happy-client/src/auth/credentials.ts exactly — both
// read/write the same macOS Keychain item so a device linked once (via the
// happy-client verification scripts) is usable from happydeck without
// re-linking. The service name itself stays "ccdeck-happy-account" (the
// product's former name) — changing it would orphan the already-linked
// Keychain item and force a re-link.
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

/// Saves Happy account credentials to the macOS Keychain — the write side
/// of get_credentials, used by the in-app QR device-link flow so linking
/// never requires the Node verification scripts/terminal.
#[tauri::command]
fn set_credentials(credentials: StoredCredentials) -> Result<(), String> {
    let entry = Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|e| e.to_string())?;
    let raw = serde_json::to_string(&credentials).map_err(|e| e.to_string())?;
    entry.set_password(&raw).map_err(|e| e.to_string())
}

#[derive(Debug, Deserialize)]
struct HappyCliSettings {
    #[serde(rename = "machineId")]
    machine_id: Option<String>,
}

/// This machine's Happy `machineId`, read from the same `~/.happy/settings.json`
/// the `happy` CLI writes — lets happydeck identify "this machine"'s own
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

/// Bare filename only — these two commands always resolve inside
/// app_config_dir() themselves, so nothing calling them should ever be
/// trying to reach outside it.
fn require_bare_filename(name: &str) -> Result<(), String> {
    if name.is_empty() || name.contains('/') || name.contains('\\') || name == ".." {
        return Err(format!("Invalid file name: {name}"));
    }
    Ok(())
}

/// Reads a small JSON/text file from this app's own config directory
/// (`~/Library/Application Support/com.happydeck.desktop` on macOS) —
/// used for zustand `persist` storage (settingsStore, workspaceStore) and
/// the debug error log. Deliberately plain `std::fs`, not the
/// `@tauri-apps/plugin-fs` JS plugin: that path was silently failing to
/// ever create the file at all (confirmed: settings never actually
/// persisted across an app restart, even though nothing surfaced as an
/// error — its own writes are wrapped in a try/catch that swallows
/// exactly this kind of silent failure). `get_credentials`/
/// `get_local_machine_id` above already prove plain std::fs I/O against
/// this app's own directories works fine, so this reuses that same,
/// already-verified mechanism instead of re-debugging the JS plugin's
/// permission-scope configuration.
#[tauri::command]
fn read_app_config_file(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    require_bare_filename(&name)?;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    match fs::read_to_string(dir.join(&name)) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Write side of read_app_config_file — see that function for why this
/// exists instead of using the JS fs plugin. `append: true` is for the
/// debug error log (errorLog.ts); persisted-store writes always overwrite.
#[tauri::command]
fn write_app_config_file(app: tauri::AppHandle, name: String, contents: String, append: bool) -> Result<(), String> {
    require_bare_filename(&name)?;
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(&name);
    if append {
        use std::io::Write;
        let mut file = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)
            .map_err(|e| e.to_string())?;
        file.write_all(contents.as_bytes()).map_err(|e| e.to_string())
    } else {
        fs::write(&path, contents).map_err(|e| e.to_string())
    }
}

/// Left inset for the traffic-light group, in the same real CSS-px space
/// as `titlebar_height` below. Kept as one named constant (not a config
/// value) since nothing else needs to vary it independently right now.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_LEFT_INSET: f64 = 12.0;

/// Vertically centers the native traffic-light buttons within the real,
/// rendered height of the frontend's `.titlebar` element (measured and
/// passed in by the caller — see src/macos_titlebar.rs for why this can't
/// just be handled via tauri.conf.json's trafficLightPosition). Re-applied
/// on every resize (see the window-event handler in `run()` below) using
/// the height cached here, since the target on-screen position has to be
/// recomputed relative to the window's new frame each time.
#[tauri::command]
fn position_traffic_lights(window: tauri::WebviewWindow, state: tauri::State<'_, TitlebarHeight>, titlebar_height: f64) -> Result<(), String> {
    *state.0.lock().unwrap() = Some(titlebar_height);
    #[cfg(target_os = "macos")]
    {
        let ptr = macos_titlebar::SendableNSWindow(window.ns_window().map_err(|e| e.to_string())?);
        window
            .run_on_main_thread(move || macos_titlebar::center_traffic_lights(ptr, titlebar_height, TRAFFIC_LIGHT_LEFT_INSET))
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
    Ok(())
}

/// Windows-only in effect (see win_clipboard.rs for why it exists at all).
/// Declared unconditionally so the single generate_handler! list below
/// doesn't need a per-OS variant — the frontend only invokes this when it
/// detects Windows, and on any other platform it fails loudly rather than
/// pretending to have copied something.
#[tauri::command]
fn copy_text_owned(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        win_clipboard::copy_text_owned(window, text)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, text);
        Err("copy_text_owned is Windows-only".to_string())
    }
}

/// Blocks the webview from ever navigating away from the app's own pages,
/// and hands any external URL to the OS browser instead.
///
/// Without this, clicking a link in an agent's markdown reply navigates
/// the WEBVIEW ITSELF to that site — the app is simply replaced by a web
/// page, with no back button and no way out short of restarting, since
/// nothing here renders browser chrome. The frontend also overrides
/// markdown's <a> rendering (see SessionTile.tsx) so the common case never
/// reaches here; this is the backstop that also catches the cases an
/// onClick handler can't, e.g. a JS-initiated location assignment, a
/// form submit, or a target=_blank popup.
///
/// Allowed: the tauri:// custom protocol the bundled frontend is served
/// from on macOS/Linux, the http://tauri.localhost virtual host it's
/// served from on Windows/Android, and http://localhost during
/// `tauri dev`. Everything else is refused and opened externally.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|_webview, url| {
            let is_app_page = match url.scheme() {
                "tauri" | "asset" | "about" | "blob" | "data" => true,
                // WebView2 has no custom-scheme support, so on
                // Windows/Android Tauri serves the bundled frontend from
                // this fixed virtual host instead of tauri:// — confirmed
                // in wry's webview2 backend, and unaffected by `useHttpsScheme`
                // (this project doesn't set it, so it's `http`, not `https`).
                // This is the app's OWN first navigation on every Windows
                // launch, not a dev convenience: refusing it here — as a
                // previous version of this guard did — left the window
                // permanently blank and unresponsive, with the refused URL
                // handed to the OS browser instead (which can't resolve a
                // `.localhost` virtual host outside this app's own webview).
                // Trusted unconditionally, not just in `cfg!(dev)`.
                "http" | "https" if url.host_str() == Some("tauri.localhost") => true,
                // The dev server. cfg!(dev) is false in a release bundle,
                // so a production build never trusts plain localhost.
                "http" | "https" => cfg!(dev) && matches!(url.host_str(), Some("localhost") | Some("127.0.0.1")),
                _ => false,
            };
            if is_app_page {
                return true;
            }
            // Only hand the OS things it should actually open. Notably NOT
            // file://, which would let a crafted link open arbitrary local
            // paths in whatever app claims them.
            if matches!(url.scheme(), "http" | "https" | "mailto") {
                let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
            }
            false
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // Windows only: turn off WebView2's inherited Edge shortcuts
            // (Ctrl+J downloads, Ctrl+P print, Ctrl+R/F5 reload, F12
            // devtools) — see win_webview.rs. Runs after the window exists
            // because it needs the live WebView2 controller.
            #[cfg(target_os = "windows")]
            {
                use tauri::Manager;
                if let Some(webview) = _app.get_webview_window("main") {
                    let _ = webview.with_webview(|platform| {
                        if let Err(error) = win_webview::disable_browser_shortcuts(&platform.controller()) {
                            eprintln!("[win_webview] could not disable browser shortcuts: {error}");
                        }
                    });
                }
            }
            Ok(())
        })
        .plugin(navigation_guard())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(TitlebarHeight(std::sync::Mutex::new(None)))
        .manage(claude_usage::ClaudePath(std::sync::Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            get_credentials,
            set_credentials,
            get_local_machine_id,
            position_traffic_lights,
            read_app_config_file,
            write_app_config_file,
            copy_text_owned,
            notification::notify_session,
            claude_usage::claude_usage
        ])
        .on_window_event(|window, event| {
            // Re-anchor on both resize AND focus change. Resize is the
            // obvious one (a fixed titlebar height still needs a different
            // absolute button position once the window itself is taller or
            // shorter). Focus is defensive redundancy alongside
            // macos_titlebar.rs's own NSViewFrameDidChangeNotification
            // observer, which is the thing actually responsible for
            // catching a key-window-transition-triggered layout change, if
            // one occurs -- direct NSView property reads taken at real
            // key/resign transitions (hidden, alphaValue, frame, z-order)
            // showed no difference at all between states, so "AppKit
            // resets the container's frame on key-status change" -- the
            // theory an earlier version of this comment stated as
            // established fact -- is NOT confirmed, and the buttons
            // disappearing when the window isn't key remains unexplained
            // at the geometry/visibility-property level. See
            // ~/Library/Logs/happydeck/titlebar-debug.log (HAPPYDECK_TITLEBAR_DEBUG=1)
            // for the instrumentation this was checked with.
            let should_reanchor = matches!(event, tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Focused(_));
            if should_reanchor {
                #[cfg(target_os = "macos")]
                {
                    let height = *window.state::<TitlebarHeight>().0.lock().unwrap();
                    if let Some(titlebar_height) = height {
                        if let Ok(ns_window) = window.ns_window() {
                            let ptr = macos_titlebar::SendableNSWindow(ns_window);
                            let _ = window.run_on_main_thread(move || {
                                macos_titlebar::center_traffic_lights(ptr, titlebar_height, TRAFFIC_LIGHT_LEFT_INSET)
                            });
                        }
                    }
                }
                #[cfg(not(target_os = "macos"))]
                {
                    let _ = window;
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
