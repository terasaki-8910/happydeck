import { getCurrentWebview } from '@tauri-apps/api/webview';

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
 * guessing. tauri.conf.json sets zoomHotkeysEnabled: false to avoid
 * double-handling; the underlying set_zoom command this calls is gated
 * only by the core:webview:allow-set-webview-zoom permission, which
 * stays independent of that flag (confirmed in Tauri's own source).
 *
 * Mirrors Tauri's own step size (0.2) and bounds (0.2..10) for parity.
 */
export function installZoomHotkeys(): () => void {
  const isMac = navigator.platform.toLowerCase().includes('mac');
  let zoomLevel = 1;

  const applyZoom = (next: number) => {
    zoomLevel = Math.min(Math.max(next, 0.2), 10);
    getCurrentWebview().setZoom(zoomLevel);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (isMac ? !event.metaKey : !event.ctrlKey) return;
    if (event.code === 'Equal') applyZoom(zoomLevel + 0.2);
    else if (event.code === 'Minus') applyZoom(zoomLevel - 0.2);
    else if (event.code === 'Digit0') applyZoom(1);
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
