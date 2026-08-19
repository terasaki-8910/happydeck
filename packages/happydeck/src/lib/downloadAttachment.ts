import { save } from '@tauri-apps/plugin-dialog';
import { writeFile } from '@tauri-apps/plugin-fs';

/** Prompts for a save location and writes already-decrypted attachment bytes there. No-op if the user cancels the dialog. */
export async function saveAttachmentToDisk(name: string, bytes: Uint8Array): Promise<void> {
  const destination = await save({ defaultPath: name });
  if (!destination) return; // user cancelled
  await writeFile(destination, bytes);
}
