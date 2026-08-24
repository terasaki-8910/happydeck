//! Windows-only: strip the browser behaviour WebView2 brings along.
//!
//! Tauri renders the UI inside WebView2 on Windows, and WebView2 ships
//! Edge's own accelerator keys enabled by default. That leaks browser
//! chrome into what is supposed to be a desktop app: Ctrl+J pops Edge's
//! downloads flyout, Ctrl+P opens a print dialog, Ctrl+R / F5 reloads the
//! whole app, F12 opens DevTools. None of these mean anything here, and
//! the reload ones are actively destructive.
//!
//! These are handled by the WebView2 runtime BEFORE the page sees them, so
//! a `keydown` listener with preventDefault() in the frontend cannot stop
//! them — `AreBrowserAcceleratorKeysEnabled` is the documented switch, and
//! Tauri 2.11 exposes no config for it (wry has
//! `with_browser_accelerator_keys`, but nothing in Tauri's own builder or
//! tauri.conf.json reaches it), so this goes through `with_webview()` to
//! the raw ICoreWebView2 instead.
//!
//! Note this does NOT disable the app's own Cmd/Ctrl+F search or the zoom
//! hotkeys — those are plain JS keydown handlers in the frontend, and
//! turning the browser's accelerators off actually stops WebView2 from
//! stealing those chords first.
//!
//! Deliberately leaves the right-click context menu alone
//! (`AreDefaultContextMenusEnabled`): it's the only working way to copy
//! into Windows Clipboard History on some builds, and removing it would
//! take away a workaround the user relies on.

use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2Controller, ICoreWebView2Settings3};
use windows::core::Interface;

/// Applies the settings above to an already-created WebView2. Returns an
/// error string rather than panicking: a failure here is cosmetic (the
/// browser shortcuts stay live), never worth taking the app down for.
pub fn disable_browser_shortcuts(controller: &ICoreWebView2Controller) -> Result<(), String> {
    // SAFETY: `controller` is a live COM interface handed to us by Tauri's
    // with_webview callback; every call below is a plain vtable call on it
    // and its own children, with no raw pointers of our own involved.
    unsafe {
        let webview = controller.CoreWebView2().map_err(|e| format!("CoreWebView2() failed: {e}"))?;
        let settings = webview.Settings().map_err(|e| format!("Settings() failed: {e}"))?;

        // AreBrowserAcceleratorKeysEnabled lives on ICoreWebView2Settings3,
        // not the base Settings interface -- cast rather than assume. An
        // older runtime that doesn't implement it fails the cast here and
        // is reported, instead of silently doing nothing.
        let settings3: ICoreWebView2Settings3 = settings
            .cast()
            .map_err(|e| format!("this WebView2 runtime has no ICoreWebView2Settings3: {e}"))?;
        settings3
            .SetAreBrowserAcceleratorKeysEnabled(false)
            .map_err(|e| format!("SetAreBrowserAcceleratorKeysEnabled failed: {e}"))?;
    }
    Ok(())
}
