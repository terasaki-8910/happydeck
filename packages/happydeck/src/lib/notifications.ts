import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { invoke } from '@tauri-apps/api/core';
import { isMac } from './platform';
import { useSettingsStore } from '../store/settingsStore';

// The plugin's `sound` field round-trips through the same notify-rust
// `Notification::sound_name()` the Rust-side notify_session command calls
// directly (confirmed by reading tauri-plugin-notification's desktop.rs,
// 2026-09-03) — so it needs the identical platform-specific magic string,
// resolved here in JS since this call has no Rust command of its own to
// branch on target_os inside.
const PLUGIN_SOUND_NAME = isMac ? 'NSUserNotificationDefaultSoundName' : 'Default';

let permissionGranted: boolean | null = null;

/** Call once at startup. Safe to call repeatedly — only prompts the OS once. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (permissionGranted !== null) {
    return permissionGranted;
  }
  permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    permissionGranted = (await requestPermission()) === 'granted';
  }
  return permissionGranted;
}

/**
 * Shows a desktop notification. When `sessionId` is given the notification
 * opens that session on click — something the Tauri notification plugin
 * cannot do on desktop at all; see src-tauri/src/notification.rs for why,
 * and App.tsx for the listener that receives the click.
 *
 * Falls back to the plugin if the clickable path fails. That path is the
 * one with a real failure mode: on Windows a toast is rejected outright
 * unless its AppUserModelID matches an installed Start-menu shortcut, and
 * a silently missing notification would be a worse regression than one
 * that merely isn't clickable.
 */
export async function notify(title: string, body: string, sessionId?: string): Promise<void> {
  if (!(await ensureNotificationPermission())) {
    return;
  }
  // `?? true` covers a settings.json written before this field existed —
  // see NotificationPrefs.sound's own doc comment.
  const soundEnabled = useSettingsStore.getState().notify.sound ?? true;
  if (sessionId) {
    try {
      await invoke('notify_session', { title, body, sessionId, soundEnabled });
      return;
    } catch (error) {
      console.warn('[notifications] clickable notification failed, falling back to plugin:', error);
    }
  }
  sendNotification({ title, body, sound: soundEnabled ? PLUGIN_SOUND_NAME : undefined });
}
