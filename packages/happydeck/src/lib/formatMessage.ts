function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

// Which arg(s) actually say something a human cares about, per tool. Tried
// in order; the first present non-empty string wins. Unlisted/unknown tools
// fall back to scanning all args for the first non-empty string.
const TOOL_DETAIL_KEYS: Record<string, string[]> = {
  Bash: ['command'],
  BashOutput: ['bash_id'],
  KillShell: ['shell_id'],
  Read: ['file_path'],
  Write: ['file_path'],
  Edit: ['file_path'],
  NotebookEdit: ['notebook_path'],
  Glob: ['pattern', 'path'],
  Grep: ['pattern', 'path'],
  WebFetch: ['url'],
  WebSearch: ['query'],
  Task: ['description', 'prompt'],
  Agent: ['description', 'prompt'],
};

function toolCallDetail(name: string, args: Record<string, unknown>): string | null {
  if (name === 'TodoWrite' && Array.isArray(args.todos)) {
    return `${args.todos.length} todo${args.todos.length === 1 ? '' : 's'}`;
  }
  const keys = TOOL_DETAIL_KEYS[name] ?? Object.keys(args);
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return truncate(value.trim(), 160);
    }
  }
  return null;
}

function toolCallSummary(ev: Record<string, unknown>): string {
  const name = typeof ev.name === 'string' ? ev.name : 'tool';
  const label = typeof ev.title === 'string' && ev.title ? ev.title : name;
  const args = (ev.args ?? {}) as Record<string, unknown>;
  const detail = toolCallDetail(name, args);
  return detail ? `[${label}] ${detail}` : `[${label}]`;
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
    if ((inner?.type === 'tool-call' || inner?.type === 'tool_use') && typeof inner.name === 'string') {
      const input = (inner.input ?? inner.args ?? {}) as Record<string, unknown>;
      return toolCallSummary({ name: inner.name, args: input });
    }
    return `<${String(inner?.type ?? 'unknown')}>`;
  }

  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    const ev = inner?.ev as Record<string, unknown> | undefined;
    if (ev?.t === 'text' && typeof ev.text === 'string') {
      return truncate(ev.text, 400);
    }
    if (ev?.t === 'tool-call-start') {
      return toolCallSummary(ev);
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
