//! Windows-only: copy text to the clipboard with THIS app's own top-level
//! window as the clipboard owner.
//!
//! Why this exists at all: on Windows the webview is WebView2 (Chromium),
//! and a normal Ctrl+C inside it produces a clipboard entry that pastes
//! fine but never shows up in Windows Clipboard History (Win+V). That is
//! an open, unfixed WebView2 defect (MicrosoftEdge/WebView2Feedback#5649
//! and #5650) which reproduces in Microsoft's own WebView2APISample and
//! explicitly does NOT happen in Edge itself -- WebView2 hands the
//! clipboard a window belonging to the msedgewebview2.exe runtime
//! process, which the clipboard-history service appears not to accept as
//! a real owner. Nothing in happydeck's own code writes the clipboard, so
//! there was nothing to "fix" short of taking the copy path over.
//!
//! Deliberately NOT done via tauri-plugin-clipboard-manager: its Windows
//! backend (arboard -> clipboard-win) calls OpenClipboard(NULL), i.e. an
//! ownerless open -- plausibly the very condition being filtered out, so
//! it would add a dependency without reliably fixing anything.
//!
//! macOS is unaffected (WKWebView doesn't go through any of this, and
//! there's no clipboard-history equivalent), hence the whole module is
//! cfg'd out there.

// GlobalFree lives in Foundation, not Memory, in this crate version --
// confirmed against windows-0.61.3's own source rather than assumed.
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_UNICODETEXT;

/// Another process can hold the clipboard open briefly; Chromium's own
/// Windows clipboard writer retries on the same principle rather than
/// failing the first time it loses the race.
const OPEN_RETRIES: u32 = 5;
const OPEN_RETRY_DELAY_MS: u64 = 5;

fn open_clipboard_with_owner(hwnd: HWND) -> Result<(), String> {
    for attempt in 0..OPEN_RETRIES {
        // SAFETY: hwnd is a live top-level window handle obtained from the
        // Tauri window we were invoked from.
        if unsafe { OpenClipboard(Some(hwnd)) }.is_ok() {
            return Ok(());
        }
        if attempt + 1 < OPEN_RETRIES {
            std::thread::sleep(std::time::Duration::from_millis(OPEN_RETRY_DELAY_MS));
        }
    }
    Err("Could not open the clipboard (another process is holding it)".to_string())
}

fn write_unicode_text(text: &str) -> Result<(), String> {
    // CF_UNICODETEXT wants a NUL-terminated UTF-16 buffer in moveable
    // global memory.
    let utf16: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    let byte_len = utf16.len() * std::mem::size_of::<u16>();

    // SAFETY: byte_len is derived from the vec we just built, so it is a
    // valid non-zero allocation size.
    let handle: HGLOBAL = unsafe { GlobalAlloc(GMEM_MOVEABLE, byte_len) }.map_err(|e| format!("GlobalAlloc failed: {e}"))?;

    // SAFETY: handle came from GlobalAlloc(GMEM_MOVEABLE) above and is
    // locked/unlocked as a matched pair; the copy stays within byte_len.
    unsafe {
        let ptr = GlobalLock(handle) as *mut u16;
        if ptr.is_null() {
            let _ = GlobalFree(Some(handle));
            return Err("GlobalLock failed".to_string());
        }
        std::ptr::copy_nonoverlapping(utf16.as_ptr(), ptr, utf16.len());
        let _ = GlobalUnlock(handle);
    }

    // SAFETY: CF_UNICODETEXT matches the buffer format written above.
    // On SUCCESS the system takes ownership of the handle and freeing it
    // ourselves would be a double free -- only free on the failure path.
    match unsafe { SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(handle.0))) } {
        Ok(_) => Ok(()),
        Err(e) => {
            unsafe { let _ = GlobalFree(Some(handle)); }
            Err(format!("SetClipboardData failed: {e}"))
        }
    }
}

/// Replaces the clipboard's contents with `text`, owned by this app's own
/// window so Windows Clipboard History records it.
///
/// Text-only by design: this writes CF_UNICODETEXT and nothing else, so a
/// copy of rendered markdown loses CF_HTML rich formatting on Windows.
/// That is the accepted trade for getting Win+V to work at all -- the
/// alternative (let WebView2 copy, then re-own every format afterwards) is
/// racy and, since the history listener is asynchronous, can still be
/// collapsed into a single entry.
pub fn copy_text_owned(window: tauri::WebviewWindow, text: String) -> Result<(), String> {
    let raw = window.hwnd().map_err(|e| format!("Could not get the window handle: {e}"))?;
    let hwnd = HWND(raw.0 as *mut core::ffi::c_void);

    open_clipboard_with_owner(hwnd)?;

    // EmptyClipboard is what actually assigns ownership to the window
    // passed to OpenClipboard -- without it the owner stays whatever it
    // was, which is the whole point of this module.
    // SAFETY: the clipboard is open (checked above) and is closed below on
    // every path.
    let result = unsafe { EmptyClipboard() }
        .map_err(|e| format!("EmptyClipboard failed: {e}"))
        .and_then(|_| write_unicode_text(&text));

    // SAFETY: matched with the successful OpenClipboard above.
    unsafe {
        let _ = CloseClipboard();
    }
    result
}
