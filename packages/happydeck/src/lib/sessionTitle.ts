import type { DecryptedMessage } from 'happy-client';

/**
 * Happy's own apps show `metadata.summary.text` — set when the agent calls
 * the `mcp__happy__change_title` tool — as the session title. It's a durable
 * field (propagates live via the same update-session event as everything
 * else in metadata), not something to re-derive by hand each render.
 *
 * Falls back to scanning already-loaded messages for that tool call
 * directly, in case metadata hasn't synced yet — costs nothing extra since
 * those messages are already fetched for the transcript.
 */
export function deriveTitle(metadata: unknown, messages: DecryptedMessage[]): string | null {
  const summary = (metadata as Record<string, unknown> | null)?.summary as { text?: string } | undefined;
  if (typeof summary?.text === 'string' && summary.text.trim()) {
    return summary.text.trim();
  }

  for (let i = messages.length - 1; i >= 0; i--) {
    const title = titleFromMessageContent(messages[i].content);
    if (title) return title;
  }
  return null;
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
