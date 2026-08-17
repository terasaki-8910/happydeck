import type { DecryptedMessage } from 'happy-client';

/**
 * Happy's session title isn't a metadata field the server populates — it
 * only exists as the agent calling the `mcp__happy__change_title` tool at
 * some point in the session's message history (usually early, but a later
 * call overrides it). Scans decrypted messages for that tool call and
 * returns the most recent title found, highest `seq` wins.
 */
export function extractTitle(messages: DecryptedMessage[]): string | null {
  let best: { seq: number; title: string } | null = null;

  for (const message of messages) {
    const title = titleFromMessageContent(message.content);
    if (title && (!best || message.seq > best.seq)) {
      best = { seq: message.seq, title };
    }
  }

  return best?.title ?? null;
}

function titleFromMessageContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') {
    return null;
  }
  const record = content as Record<string, unknown>;

  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    const ev = inner?.ev as Record<string, unknown> | undefined;
    if (ev?.t === 'tool-call-start' && ev.name === 'mcp__happy__change_title') {
      const args = ev.args as Record<string, unknown> | undefined;
      if (typeof args?.title === 'string' && args.title.trim()) {
        return args.title.trim();
      }
    }
    return null;
  }

  if (record.role === 'agent') {
    const inner = record.content as Record<string, unknown> | undefined;
    if ((inner?.type === 'tool-call' || inner?.type === 'tool_use') && inner?.name === 'mcp__happy__change_title') {
      const input = (inner.input ?? inner.args) as Record<string, unknown> | undefined;
      if (typeof input?.title === 'string' && input.title.trim()) {
        return input.title.trim();
      }
    }
  }

  return null;
}
