import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';

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

export async function notify(title: string, body: string): Promise<void> {
  if (!(await ensureNotificationPermission())) {
    return;
  }
  sendNotification({ title, body });
}
