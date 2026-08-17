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

/** Session-envelope event types that carry no human-readable content of their own — pure protocol bookkeeping, not worth a transcript line. */
const HIDDEN_SESSION_EVENTS = new Set(['turn-start', 'turn-end', 'tool-call-end', 'start', 'stop']);

/** Whether this message is worth a line in the transcript at all. */
export function isRenderableMessage(content: unknown): boolean {
  if (content === null || content === undefined) {
    return true; // "(failed to decrypt)" is worth showing
  }
  if (typeof content !== 'object') {
    return true;
  }
  const record = content as Record<string, unknown>;
  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    const ev = inner?.ev as Record<string, unknown> | undefined;
    return !HIDDEN_SESSION_EVENTS.has(String(ev?.t));
  }
  return true;
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
    if (ev?.t === 'service' && typeof ev.text === 'string') {
      return ev.text;
    }
    if (ev?.t === 'file' && typeof ev.name === 'string') {
      return `[file] ${ev.name}`;
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

/** true = render this line in the monospace font (code/commands/paths), false = normal prose font. */
export function isCodeLikeMessage(content: unknown): boolean {
  if (!content || typeof content !== 'object') {
    return false;
  }
  const record = content as Record<string, unknown>;
  const inner = record.content as Record<string, unknown> | undefined;
  if (record.role === 'session') {
    const ev = inner?.ev as Record<string, unknown> | undefined;
    return ev?.t === 'tool-call-start' || ev?.t === 'file';
  }
  if (record.role === 'agent') {
    return inner?.type === 'tool-call' || inner?.type === 'tool_use';
  }
  return false;
}
