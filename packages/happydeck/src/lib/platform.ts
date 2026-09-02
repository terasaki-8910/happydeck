/**
 * True on macOS, computed once at module load. `navigator.platform` is
 * deprecated but has no drop-in replacement inside this Tauri/WebKit
 * target (no `navigator.userAgentData` here), and is already the
 * established way this app tells platforms apart on the frontend — see
 * the original use in zoomHotkeys.ts (Cmd vs Ctrl for zoom shortcuts).
 */
export const isMac = navigator.platform.toLowerCase().includes('mac');
