//! Clickable desktop notifications.
//!
//! `@tauri-apps/plugin-notification` cannot do this: its desktop `show()`
//! does `tauri::async_runtime::spawn(async move { let _ = notification.show(); })`
//! (tauri-plugin-notification-2.3.3/src/desktop.rs:216) — it throws away the
//! `NotificationHandle`, which is the only thing that can tell you the user
//! clicked. Its `onNotificationReceived`/`onAction` JS listeners are
//! `addPluginListener` calls into the Android/iOS plugin; the Rust crate
//! emits no such event on desktop, so registering them here yields nothing.
//! (Both are open upstream requests: tauri#3698, plugins-workspace#2150.)
//!
//! So this talks to `notify-rust` directly and keeps the handle. That crate
//! backs macOS with `mac-notification-sys` and Windows with
//! `tauri-winrt-notification`, and both expose the same
//! `wait_for_response` — one code path covers both platforms.
//!
//! Deliberately `wait_for_response`, not the older `wait_for_action`: on
//! Windows a click on the toast *body* activates with no action key, and
//! `wait_for_action` collapses that case to the same `"__closed"` string a
//! dismissal produces (see notify-rust-4.18.0/src/windows.rs:112-118), so a
//! plain click would be indistinguishable from ignoring the toast. The
//! typed API keeps `Default` (body click) separate from `Closed`.

use notify_rust::{Notification, NotificationResponse};
use std::sync::atomic::{AtomicUsize, Ordering};
use tauri::{AppHandle, Emitter, Manager};

/// Event the frontend listens for; payload is the session id to open.
pub const ACTIVATED_EVENT: &str = "notification-activated";

/// Waiting for a click costs one blocked thread for as long as the
/// notification is on screen. Both backends do resolve on auto-dismiss
/// (macOS polls `deliveredNotifications` from a main-thread timer,
/// mac-notification-sys/objc/notify.m:212-231; Windows gets `on_dismissed`
/// with `TimedOut`), so these threads are not expected to accumulate — this
/// cap only bounds the damage if some future backend stops resolving.
/// Past the cap the notification is still shown, just not clickable.
const MAX_PENDING_WAITERS: usize = 8;
static PENDING_WAITERS: AtomicUsize = AtomicUsize::new(0);

fn focus_session(app: &AppHandle, session_id: &str) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    let _ = app.emit(ACTIVATED_EVENT, session_id);
}

fn build(app: &AppHandle, title: &str, body: &str, sound_enabled: bool) -> Notification {
    let mut notification = Notification::new();
    notification.summary(title).body(body);

    // Sound is opt-IN on both platforms this app ships a notification
    // sound on (confirmed by reading notify-rust/mac-notification-sys/
    // tauri-winrt-notification source directly, 2026-09-03): a
    // never-called `sound_name()` leaves macOS's NSUserNotification.soundName
    // nil and produces Windows' own explicit `<audio silent="true"/>` toast
    // XML. There is no separate "silent" flag beyond simply not calling
    // this — and no volume control exists in either native framework at
    // all, at any layer; that's a real absence, not a gap in these crates,
    // so a volume slider is never coming to this Settings section.
    if sound_enabled {
        #[cfg(target_os = "macos")]
        {
            // The one string mac-notification-sys's ObjC bridge special-cases
            // back into the real NSUserNotificationDefaultSoundName constant
            // (objc/notify.m) — any other string names a specific sound file
            // instead.
            notification.sound_name("NSUserNotificationDefaultSoundName");
        }
        #[cfg(target_os = "windows")]
        {
            // -> winrt_notification::Sound::Default -> an empty <audio> toast
            // element, i.e. "play the OS's own default toast sound".
            notification.sound_name("Default");
        }
    }

    #[cfg(target_os = "macos")]
    {
        // NSUserNotificationCenter attributes a notification to a *bundle*,
        // not to a process, so an unbundled dev run has nothing to attach
        // to and the notification silently never appears. Same escape hatch
        // the Tauri plugin uses: borrow Terminal's bundle in dev.
        let _ = notify_rust::set_application(if tauri::is_dev() {
            "com.apple.Terminal"
        } else {
            &app.config().identifier
        });
    }

    #[cfg(target_os = "windows")]
    {
        // The AUMID has to match a Start-menu shortcut for Windows to
        // accept the toast at all, and only the installer creates one — so
        // in a `target/debug|release` run we must NOT set it, and fall back
        // to notify-rust's PowerShell AUMID, which always resolves.
        // Mirrors tauri-plugin-notification's own check.
        let is_installed = tauri::utils::platform::current_exe()
            .ok()
            .and_then(|exe| exe.parent().map(|dir| dir.display().to_string()))
            .map(|dir| {
                let sep = std::path::MAIN_SEPARATOR;
                !(dir.ends_with(&format!("{sep}target{sep}debug"))
                    || dir.ends_with(&format!("{sep}target{sep}release")))
            })
            .unwrap_or(false);
        if is_installed {
            notification.app_id(&app.config().identifier);
        }
    }

    notification
}

/// Shows a notification that opens `session_id` when clicked.
///
/// Returns `Err` rather than failing silently so the caller can fall back
/// to the plugin — on Windows a missing AUMID registration makes the toast
/// fail outright, and no notification at all would be worse than one that
/// simply isn't clickable.
#[tauri::command]
pub fn notify_session(
    app: AppHandle,
    title: String,
    body: String,
    session_id: String,
    sound_enabled: bool,
) -> Result<(), String> {
    let notification = build(&app, &title, &body, sound_enabled);

    if PENDING_WAITERS.load(Ordering::Relaxed) >= MAX_PENDING_WAITERS {
        return notification.show().map(|_| ()).map_err(|e| e.to_string());
    }

    // Must not be the main thread: on macOS the delegate callbacks that
    // resolve this are delivered *on* the main run loop, so blocking it
    // here would deadlock until the notification auto-dismissed.
    // mac-notification-sys handles the off-main-thread case explicitly
    // (objc/notify.m:209 "callbacks come in on main thread, start poll
    // timer there").
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    std::thread::spawn(move || {
        PENDING_WAITERS.fetch_add(1, Ordering::Relaxed);
        let handle = match notification.show() {
            Ok(handle) => {
                let _ = ready_tx.send(Ok(()));
                handle
            }
            Err(error) => {
                let _ = ready_tx.send(Err(error.to_string()));
                PENDING_WAITERS.fetch_sub(1, Ordering::Relaxed);
                return;
            }
        };
        let _ = handle.wait_for_response(|response: &NotificationResponse| match response {
            // Default = the notification body itself was clicked.
            // Action = one of its buttons; we add none, but a future one
            // would still mean "the user wants this session".
            NotificationResponse::Default | NotificationResponse::Action(_) => {
                focus_session(&app, &session_id);
            }
            _ => {}
        });
        PENDING_WAITERS.fetch_sub(1, Ordering::Relaxed);
    });

    // Only waits for delivery, not for the click.
    ready_rx
        .recv()
        .unwrap_or_else(|_| Err("notification thread ended before delivery".into()))
}
