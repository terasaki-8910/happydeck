function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Renders a decrypted message's content (legacy user/agent shape or the newer session-envelope shape) as one readable line. */
export function summarizeMessageContent(content: unknown): string {
  if (content === null || content === undefined) {
    return '(failed to decrypt)';
  }
  if (typeof content !== 'object') {
    return String(content);
  }
  const record = content as Record<string, unknown>;

  if (record.role === 'user' || record.role === 'agent') {
    const inner = record.content as Record<string, unknown> | undefined;
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      return truncate(inner.text, 400);
    }
    return `<${String(inner?.type ?? 'unknown')}>`;
  }

  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    const ev = inner?.ev as Record<string, unknown> | undefined;
    if (ev?.t === 'text' && typeof ev.text === 'string') {
      return truncate(ev.text, 400);
    }
    if (ev?.t === 'tool-call-start' && typeof ev.title === 'string') {
      return `[tool] ${ev.title}`;
    }
    return `[${String(ev?.t ?? 'unknown')}]`;
  }

  return truncate(JSON.stringify(content), 200);
}

export function messageRole(content: unknown): 'user' | 'agent' | 'system' {
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (record.role === 'user') {
      return 'user';
    }
    if (record.role === 'agent' || record.role === 'session') {
      return 'agent';
    }
  }
  return 'system';
}
