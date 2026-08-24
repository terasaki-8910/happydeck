import { invoke } from '@tauri-apps/api/core';

/**
 * Windows only: take over Ctrl+C so the copy lands in Windows Clipboard
 * History (Win+V).
 *
 * WebView2's own clipboard write pastes fine but is never recorded by
 * Clipboard History — an open, unfixed WebView2 defect
 * (MicrosoftEdge/WebView2Feedback#5649 / #5650) that reproduces in
 * Microsoft's own sample app and does not happen in Edge itself. The fix
 * is to write the clipboard from Rust with this app's own top-level HWND
 * as the owner; see src-tauri/src/win_clipboard.rs.
 *
 * No-op everywhere else: WKWebView doesn't have the defect and macOS has
 * no clipboard-history equivalent, so the native copy is left completely
 * alone there.
 */
export function installWindowsClipboardFix(): () => void {
  if (!navigator.userAgent.includes('Windows')) return () => {};

  const onCopy = (event: ClipboardEvent) => {
    const active = document.activeElement;
    let text = '';
    // A selection inside a <textarea>/<input> is NOT reachable via
    // document.getSelection().toString() in Chromium — it returns ''. The
    // composer is a textarea, so without this branch copying from it would
    // silently break on Windows (worse than the bug being fixed).
    if (active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement) {
      text = active.value.slice(active.selectionStart ?? 0, active.selectionEnd ?? 0);
    } else {
      text = document.getSelection()?.toString() ?? '';
    }

    // Nothing textual selected (e.g. an image copy) — leave it to WebView2
    // rather than clobbering the clipboard with an empty string.
    if (!text) return;

    event.preventDefault();
    void invoke('copy_text_owned', { text }).catch((error) => {
      // If the Rust side failed we've already preventDefault'd, so the
      // clipboard would otherwise be left untouched with the user
      // believing they copied. Fall back to the standard API so the copy
      // still happens — just without the history entry.
      console.error('[winClipboard] owned copy failed, falling back:', error);
      void navigator.clipboard?.writeText(text);
    });
  };

  document.addEventListener('copy', onCopy, true);
  return () => document.removeEventListener('copy', onCopy, true);
}
