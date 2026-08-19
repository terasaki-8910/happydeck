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

// Session-envelope event types that carry no human-readable content of
// their own — pure protocol bookkeeping, not worth a transcript line.
const HIDDEN_SESSION_EVENTS = new Set(['turn-start', 'turn-end', 'tool-call-end', 'start', 'stop']);
// Tool calls that are metadata side-effects (setting the chat title), not
// something worth showing as a turn in the conversation.
const HIDDEN_TOOL_NAMES = new Set(['mcp__happy__change_title']);

export type RenderablePart =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; label: string; detail: string | null; description: string | null }
  | {
      kind: 'file';
      name: string;
      /** Session-protocol file events only (happy-wire's sessionFileEventSchema) — a pasted-into-the-terminal image uploaded via Happy's own blob protocol. null for anything else (e.g. a plain-text "[file]" reference with no attachment metadata at all) — preview/download needs ref to fetch the blob. */
      ref: string | null;
      size: number | null;
      mimeType: string | null;
    }
  | { kind: 'raw'; text: string };

function toolCallDetail(name: string, args: Record<string, unknown>): string | null {
  if (name === 'TodoWrite' && Array.isArray(args.todos)) {
    return `${args.todos.length} todo${args.todos.length === 1 ? '' : 's'}`;
  }
  const keys = TOOL_DETAIL_KEYS[name] ?? Object.keys(args);
  for (const key of keys) {
    const value = args[key];
    if (typeof value === 'string' && value.trim()) {
      return truncate(value.trim(), 220);
    }
  }
  return null;
}

function toolCallPart(ev: Record<string, unknown>): RenderablePart {
  const name = typeof ev.name === 'string' ? ev.name : 'tool';
  const label = typeof ev.title === 'string' && ev.title ? ev.title : name;
  const args = (ev.args ?? {}) as Record<string, unknown>;
  const detail = toolCallDetail(name, args);
  // The CLI often sets description === title verbatim — showing both reads as a duplicated line.
  const rawDescription = typeof ev.description === 'string' ? ev.description.trim() : '';
  const description = rawDescription && rawDescription !== label ? rawDescription : null;
  return { kind: 'tool-call', label, detail, description };
}

/**
 * Parses a decrypted message's content (legacy user/agent shape or the
 * newer session-envelope shape) into a renderable part, or null if it's
 * pure protocol noise (turn markers, the change-title side effect) not
 * worth a line in the transcript.
 */
export function renderablePart(content: unknown): RenderablePart | null {
  if (content === null || content === undefined) {
    return { kind: 'raw', text: '(failed to decrypt)' };
  }
  if (typeof content !== 'object') {
    return { kind: 'raw', text: String(content) };
  }
  const record = content as Record<string, unknown>;

  if (record.role === 'user' || record.role === 'agent') {
    const inner = record.content as Record<string, unknown> | undefined;
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      return { kind: 'text', text: inner.text };
    }
    if ((inner?.type === 'tool-call' || inner?.type === 'tool_use') && typeof inner.name === 'string') {
      if (HIDDEN_TOOL_NAMES.has(inner.name)) return null;
      const input = (inner.input ?? inner.args ?? {}) as Record<string, unknown>;
      return toolCallPart({ name: inner.name, args: input });
    }
    return { kind: 'raw', text: `<${String(inner?.type ?? 'unknown')}>` };
  }

  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    const ev = inner?.ev as Record<string, unknown> | undefined;
    const evType = String(ev?.t);
    if (HIDDEN_SESSION_EVENTS.has(evType)) return null;
    if (ev?.t === 'text' && typeof ev.text === 'string') {
      return { kind: 'text', text: ev.text };
    }
    if (ev?.t === 'service' && typeof ev.text === 'string') {
      return { kind: 'raw', text: ev.text };
    }
    if (ev?.t === 'file' && typeof ev.name === 'string') {
      return {
        kind: 'file',
        name: ev.name,
        ref: typeof ev.ref === 'string' ? ev.ref : null,
        size: typeof ev.size === 'number' ? ev.size : null,
        mimeType: typeof ev.mimeType === 'string' ? ev.mimeType : null,
      };
    }
    if (ev?.t === 'tool-call-start') {
      if (typeof ev.name === 'string' && HIDDEN_TOOL_NAMES.has(ev.name)) return null;
      return toolCallPart(ev);
    }
    return { kind: 'raw', text: `[${evType}]` };
  }

  return { kind: 'raw', text: truncate(JSON.stringify(content), 200) };
}

export function messageRole(content: unknown): 'user' | 'agent' | 'system' {
  if (content && typeof content === 'object') {
    const record = content as Record<string, unknown>;
    if (record.role === 'user') {
      return 'user';
    }
    // A session-protocol envelope (happy-wire's SessionEnvelope) carries its
    // own role separately from this outer wrapper — text typed directly
    // into the CLI's own terminal arrives this way (the local-transcript
    // scanner mirrors it as role:'session' with an inner role:'user'
    // envelope), not as a plain role:'user' message like something sent
    // through happydeck itself. Without checking the inner role, it read
    // as an agent reply — no bubble, left-aligned, no way to tell the user
    // said it.
    if (record.role === 'session') {
      const envelope = record.content as Record<string, unknown> | undefined;
      return envelope?.role === 'user' ? 'user' : 'agent';
    }
    if (record.role === 'agent') {
      return 'agent';
    }
  }
  return 'system';
}
