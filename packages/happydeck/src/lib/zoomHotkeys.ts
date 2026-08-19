/**
 * Tauri's own built-in zoomHotkeysEnabled injects a script that matches
 * `event.key === '='`/`'+'`/`'-'` — a *character*, which depends on the
 * OS keyboard layout currently active, not the physical key pressed. On
 * a JIS (Japanese) layout the physical key in that position doesn't
 * produce those characters, so Cmd+= silently does nothing (or, per the
 * user's own diagnosis, ends up matching a completely different bound
 * shortcut like Cmd+;). Re-implemented here using `event.code`
 * ('Equal'/'Minus'/'Digit0'), which identifies the physical key
 * regardless of layout — confirmed correct approach by reading Tauri's
 * own injected script source (zoom-hotkey.js) directly rather than
 * guessing. tauri.conf.json keeps zoomHotkeysEnabled: false so that
 * built-in handler never fires in parallel with this one.
 *
 * Zoom is applied via CSS `zoom` on the document root, NOT Tauri's
 * getCurrentWebview().setZoom() (WKWebView's `pageZoom`). Confirmed live:
 * at a non-1.0 pageZoom the composer's focused textarea rendered a
 * smeared/artifacted bar instead of legible text. pageZoom scales
 * already-laid-out, already-rasterized content as a post-hoc transform;
 * WebKit's native-backed editable-text rendering (caret, selection,
 * glyph rasterization) isn't fully redone at the target scale, so it
 * comes out blurry specifically in focused inputs. CSS `zoom` instead
 * triggers a real layout+rasterization pass AT the target size — same
 * WebKit engine, fully supported property, no separate scale-transform
 * step to produce that artifact.
 *
 * Mirrors Tauri's own step size (0.2) and bounds (0.2..10) for parity.
 *
 * Default zoom is 1.1, not the webview's native 1.0 — applied explicitly
 * here on install, since just changing this starting value wouldn't touch
 * the actual rendered zoom on its own (nothing else applies zoom until
 * the user's first Cmd+=/Cmd+-/scroll). Deliberately NOT a full 0.2 step
 * (1.2) — confirmed too large a jump; 1.1 is a half-step, off the normal
 * Cmd+= increment grid on purpose.
 */
const DEFAULT_ZOOM = 1.1;

export function installZoomHotkeys(): () => void {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  let zoomLevel = DEFAULT_ZOOM;

  const applyZoom = (next: number) => {
    zoomLevel = Math.min(Math.max(next, 0.2), 10);
    document.documentElement.style.zoom = String(zoomLevel);
  };

  applyZoom(DEFAULT_ZOOM);

  const onKeyDown = (event: KeyboardEvent) => {
    if (isMac ? !event.metaKey : !event.ctrlKey) return;
    if (event.code === 'Equal') applyZoom(zoomLevel + 0.2);
    else if (event.code === 'Minus') applyZoom(zoomLevel - 0.2);
    else if (event.code === 'Digit0') applyZoom(DEFAULT_ZOOM);
    else return;
    event.preventDefault();
  };

  const onWheel = (event: WheelEvent) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    applyZoom(zoomLevel + (event.deltaY < 0 ? 0.2 : -0.2));
  };

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('wheel', onWheel);
  };
}
