import { save } from '@tauri-apps/plugin-dialog';
import { writeTextFile } from '@tauri-apps/plugin-fs';
import type { LiveSession } from '../store/happyStore';
import { isRenderableMessage, messageRole, summarizeMessageContent } from './formatMessage';
import { deriveTitle } from './sessionTitle';

function sanitizeForFilename(value: string): string {
  return value.replace(/[/\\:*?"<>|]+/g, '_').slice(0, 60).trim() || 'session';
}

function buildTranscriptText(session: LiveSession): string {
  const metadata = session.metadata as { path?: string; host?: string } | null;
  const title = deriveTitle(session.metadata, session.messages) ?? metadata?.path ?? session.id;
  const lines: string[] = [`# ${title}`, `host: ${metadata?.host ?? 'unknown'}`, `path: ${metadata?.path ?? 'unknown'}`, `session: ${session.id}`, ''];

  for (const message of session.messages) {
    if (!isRenderableMessage(message.content)) continue;
    const timestamp = new Date(message.createdAt).toISOString();
    lines.push(`[${timestamp}] ${messageRole(message.content)}:`, summarizeMessageContent(message.content), '');
  }

  return lines.join('\n');
}

/** Prompts for a save location and writes the session's transcript as plain text. */
export async function downloadTranscript(session: LiveSession): Promise<void> {
  const metadata = session.metadata as { path?: string } | null;
  const title = deriveTitle(session.metadata, session.messages) ?? metadata?.path ?? session.id;
  const defaultName = `happydeck-${sanitizeForFilename(title)}.txt`;

  const destination = await save({
    defaultPath: defaultName,
    filters: [{ name: 'Text', extensions: ['txt'] }],
  });
  if (!destination) return; // user cancelled

  await writeTextFile(destination, buildTranscriptText(session));
}
