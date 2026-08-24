import { backgroundTaskFallbackText, sessionExitedWithCodeText } from './errorMessages';
import { useSettingsStore } from '../store/settingsStore';

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
  | {
      /** A Claude Code background-task completion notice (Agent/Workflow/Monitor/background-Bash) — arrives as plain text wrapped in <task-notification> tags meant for the CLI's own agent loop, not chat prose. See taskNotificationPart below. */
      kind: 'task-notification';
      status: 'completed' | 'failed' | 'killed' | 'stopped' | null;
      headline: string;
      body: string | null;
      metrics: string[];
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

// Claude Code CLI's own transcript convention for a local slash command
// (e.g. /model): the invocation itself arrives wrapped as
// <command-name>/model</command-name><command-message>model</command-message><command-args>…</command-args>,
// and its result as <local-command-stdout>…</local-command-stdout>. Two
// invocation orderings exist across CLI versions — <command-name> first
// (the original, still the common case) and <command-message> first (newer,
// seen on plugin/skill commands), where <command-args> is also optional.
// Both are meant for a terminal that parses (or doesn't render) them, not
// this UI's plain-text rendering, where the tags showed up as literal text.
const LOCAL_COMMAND_INVOCATION_NAME_FIRST =
  /^<command-name>([^<]*)<\/command-name>\s*<command-message>[^<]*<\/command-message>\s*(?:<command-args>([^<]*)<\/command-args>)?$/;
const LOCAL_COMMAND_INVOCATION_MESSAGE_FIRST =
  /^<command-message>[^<]*<\/command-message>\s*<command-name>([^<]*)<\/command-name>\s*(?:<command-args>([^<]*)<\/command-args>)?$/;
const LOCAL_COMMAND_STDOUT = /^<local-command-stdout>([\s\S]*)<\/local-command-stdout>$/;

// `!bash`-mode's own equivalent of the local-command tags above — same
// terminal-only convention, same fix: the invocation is something the user
// actually did (worth a line, attributed to them), the output is not
// something they said.
const BASH_INPUT = /^<bash-input>([\s\S]*)<\/bash-input>$/;
const BASH_OUTPUT = /^(?:<bash-stdout>([\s\S]*?)<\/bash-stdout>)?(?:<bash-stderr>([\s\S]*?)<\/bash-stderr>)?$/;

// Claude Code CLI's background-task completion notice (Agent/Workflow/
// Monitor/background-Bash) — happy-cli's transcript mapper strips every
// field except the raw text (grepped the CLI bundle: no trace of `origin`,
// `promptSource`, or `task-notification` survives), so this is the only
// interception point. Not anchored to the whole string (^...$) like the
// patterns above — a "[SYSTEM NOTIFICATION - NOT USER INPUT]" preamble line
// can precede the tag, confirmed against real transcripts.
// The trailing `(?:<\/task-notification>|$)` rather than a required
// closing tag: a notice cut short mid-block (a transcript still being
// written, a truncating mirror) would otherwise fail the match and fall
// straight back to dumping the raw XML as chat prose — the one outcome
// this whole path exists to avoid. A partial block still yields a
// headline whenever <summary> made it through.
const TASK_NOTIFICATION = /<task-notification>([\s\S]*?)(?:<\/task-notification>|$)/;

function extractTag(body: string, tag: string): string | null {
  const match = body.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
  return match ? match[1] : null;
}

/**
 * Same as extractTag, but takes the LAST match instead of the first.
 * Real free-text body content (<result>/<event>/<failures>) always comes
 * after the fixed-shape bookkeeping fields (task-id, status, diagnostics,
 * usage, ...) in every sample checked — and while genuine body content
 * never itself contains an unescaped tag (confirmed independently over the
 * full local corpus), <diagnostics> is agent-facing free text that COULD
 * quote an example containing literal angle brackets. Taking the last
 * match means a stray look-alike earlier in the body can never shadow the
 * real, trailing tag.
 */
function extractLastTag(body: string, tag: string): string | null {
  const matches = [...body.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'g'))];
  return matches.length > 0 ? matches[matches.length - 1][1] : null;
}

const XML_ENTITIES: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'" };
function unescapeXmlEntities(text: string): string {
  return text.replace(/&lt;|&gt;|&amp;|&quot;|&#39;/g, (entity) => XML_ENTITIES[entity]);
}

function formatDuration(ms: number): string {
  const minutes = ms / 60_000;
  return minutes >= 1 ? `${minutes.toFixed(1)}m` : `${Math.round(ms / 1000)}s`;
}

function formatTokenCount(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}K tok` : `${n} tok`;
}

const TASK_NOTIFICATION_STATUSES = new Set(['completed', 'failed', 'killed', 'stopped']);

/**
 * Recognizes a <task-notification> block anywhere in the text. Once the
 * opening tag matches, this never returns null: the fallback would be
 * rendering the raw XML as chat prose, which is exactly the failure this
 * exists to prevent. Missing inner fields degrade field by field instead.
 */
function taskNotificationPart(text: string): RenderablePart | null {
  const outer = text.match(TASK_NOTIFICATION);
  if (!outer) return null;
  const body = outer[1];

  // <summary> is what every real sample carries (verified against the 236
  // <task-notification> blocks present across every local project
  // transcript), but bailing out when it is missing would fall back to
  // rendering the whole XML blob as prose — the single ugliest thing this
  // function can produce. A headline built from <status> is a worse
  // headline; a raw tag dump is a broken UI. So degrade, never bail.
  const rawSummary = extractTag(body, 'summary');
  const headline = rawSummary ? unescapeXmlEntities(rawSummary).trim() : backgroundTaskFallbackText(useSettingsStore.getState().language);

  const rawStatus = extractTag(body, 'status');
  const status = rawStatus && TASK_NOTIFICATION_STATUSES.has(rawStatus) ? (rawStatus as Extract<RenderablePart, { kind: 'task-notification' }>['status']) : null;

  const usageBlock = extractTag(body, 'usage');
  const metrics: string[] = [];
  if (usageBlock) {
    const agentCount = extractTag(usageBlock, 'agent_count');
    const agentsDone = extractTag(usageBlock, 'agents_done');
    const agentsError = extractTag(usageBlock, 'agents_error');
    const subagentTokens = extractTag(usageBlock, 'subagent_tokens');
    const toolUses = extractTag(usageBlock, 'tool_uses');
    const durationMs = extractTag(usageBlock, 'duration_ms');
    if (agentsDone && agentCount) metrics.push(`${agentsDone}/${agentCount} agents`);
    if (agentsError && agentsError !== '0') metrics.push(`${agentsError} errors`);
    if (durationMs) metrics.push(formatDuration(Number(durationMs)));
    if (subagentTokens) metrics.push(formatTokenCount(Number(subagentTokens)));
    if (toolUses) metrics.push(`${toolUses} tools`);
  }

  // <result>/<event> is the actual output worth reading; <failures> (seen on
  // a workflow whose verify stage partially errored) is worth keeping too,
  // appended after — everything else (task-id, tool-use-id, output-file,
  // note, diagnostics, zero-valued agents_skipped/agents_empty_result,
  // worktree) is internal re-run/handle bookkeeping, deliberately dropped.
  const rawMain = extractLastTag(body, 'result') ?? extractLastTag(body, 'event');
  const rawFailures = extractLastTag(body, 'failures');
  const bodyParts = [rawMain, rawFailures].filter((part): part is string => Boolean(part)).map((part) => unescapeXmlEntities(part).trim());
  const bodyText = bodyParts.length > 0 ? bodyParts.join('\n\n---\n\n') : null;

  return { kind: 'task-notification', status, headline, body: bodyText, metrics };
}

// The stdout above is written for a real terminal, so it can carry raw ANSI
// SGR codes (\x1b[1m for bold on, \x1b[22m for bold off, etc.) — a plain
// <span> has no ANSI interpreter, so these rendered as literal tofu boxes
// (the unprintable ESC byte) glued to their own leftover "1m"/"22m" text.
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching the ESC byte to strip it
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

type SpecialTextClassification = { role: 'user' | 'system'; part: RenderablePart | null };

/**
 * Recognizes text that represents something OTHER than free-form prose from
 * whoever nominally "owns" the message per its outer envelope. happy-cli's
 * local-transcript mirror wraps a slash-command's own stdout, a !bash
 * command's own stdout/stderr, and a background-task notice in a
 * role:'user' envelope regardless of who/what actually produced the text
 * (confirmed against the CLI bundle: the mapper drops every discriminator
 * except the raw string) — none of those are the user talking, even though
 * the envelope says 'user'. The command/bash *invocation* lines are the one
 * exception: the user really did type "/model" or "!ls", so those keep role
 * 'user' and just get a compact tool-call-style treatment instead of
 * literal tags.
 */
function classifySpecialText(text: string): SpecialTextClassification | null {
  const taskNotification = taskNotificationPart(text);
  if (taskNotification) return { role: 'system', part: taskNotification };

  const invocation = text.match(LOCAL_COMMAND_INVOCATION_NAME_FIRST) ?? text.match(LOCAL_COMMAND_INVOCATION_MESSAGE_FIRST);
  if (invocation) {
    const [, name, args] = invocation;
    return { role: 'user', part: { kind: 'tool-call', label: args?.trim() ? `${name} ${args.trim()}` : name, detail: null, description: null } };
  }
  const stdout = text.match(LOCAL_COMMAND_STDOUT);
  if (stdout) {
    const cleaned = stripAnsi(stdout[1]).trim();
    return { role: 'system', part: cleaned ? { kind: 'text', text: cleaned } : null };
  }

  const bashInput = text.match(BASH_INPUT);
  if (bashInput) {
    return { role: 'user', part: { kind: 'tool-call', label: `! ${bashInput[1].trim()}`, detail: null, description: null } };
  }
  const bashOutput = text.match(BASH_OUTPUT);
  if (bashOutput && (bashOutput[1] !== undefined || bashOutput[2] !== undefined)) {
    const combined = [bashOutput[1], bashOutput[2]]
      .filter((part): part is string => Boolean(part))
      .map((part) => stripAnsi(part).trim())
      .filter(Boolean)
      .join('\n');
    return { role: 'system', part: combined ? { kind: 'text', text: combined } : null };
  }

  return null;
}

type ClassifiedMessage = { role: 'user' | 'agent' | 'system'; part: RenderablePart | null };

// Client-side session-lifecycle subtypes carried in a legacy `{type:'event',
// data}` envelope's `data.type` (see classifyLegacyEvent) that are pure
// plumbing, not conversation content -- 'switch' (local<->remote mode
// handoff) fires on EVERY message sent to a session with an active local
// terminal, which is this app's core use case; 'ready' is an idle ping.
// Same precedent as HIDDEN_SESSION_EVENTS above, just a different envelope
// shape carrying it.
const HIDDEN_LEGACY_EVENT_TYPES = new Set(['switch', 'ready']);

/**
 * happy-cli's `sendSessionEvent()` wraps session-lifecycle notices (mode
 * switch, idle ping, a human-readable status string, a process-exit code)
 * as `{role:'agent', content:{type:'event', data: event}}` — a shape this
 * app's own content.type check above didn't recognize, so EVERY one fell
 * through to the generic `<${type}>` fallback and rendered as a literal,
 * unstyled "<event>" line ahead of the real reply. Confirmed as the
 * literal source of that text (not a truncated/malformed real tag) by
 * reading formatMessage.ts's own fallback logic — happy-cli's wire content
 * never contains the string "<event>" at all, this file was the one
 * writing it. `data.type` distinguishes the actual subtype; an unrecognized
 * future subtype degrades to silence (matching the sibling
 * HIDDEN_SESSION_EVENTS handling) rather than back to a raw tag.
 */
function classifyLegacyEvent(outerRole: 'user' | 'agent', data: Record<string, unknown>): ClassifiedMessage {
  const eventType = typeof data.type === 'string' ? data.type : null;
  if (eventType && HIDDEN_LEGACY_EVENT_TYPES.has(eventType)) return { role: outerRole, part: null };
  if (eventType === 'message' && typeof data.message === 'string' && data.message.trim()) {
    return { role: 'system', part: { kind: 'text', text: data.message.trim() } };
  }
  if (eventType === 'exit' && typeof data.code === 'number' && data.code !== 0) {
    return { role: 'system', part: { kind: 'text', text: sessionExitedWithCodeText(useSettingsStore.getState().language, data.code) } };
  }
  return { role: outerRole, part: null };
}

/**
 * The single source of truth for both renderablePart() and messageRole()
 * below — they used to be two independent passes over the same content,
 * which is exactly how a message whose role should depend on what's
 * actually inside it (see classifySpecialText) ended up correctly
 * text-parsed by one pass while the other still stamped it with the outer
 * envelope's role verbatim (e.g. local-command stdout rendering as a
 * right-aligned user bubble even though its TEXT was already being
 * recognized and cleaned).
 */
function classify(content: unknown): ClassifiedMessage {
  if (content === null || content === undefined) {
    return { role: 'system', part: { kind: 'raw', text: '(failed to decrypt)' } };
  }
  if (typeof content !== 'object') {
    return { role: 'system', part: { kind: 'raw', text: String(content) } };
  }
  const record = content as Record<string, unknown>;

  if (record.role === 'user' || record.role === 'agent') {
    const outerRole = record.role === 'user' ? 'user' : 'agent';
    const inner = record.content as Record<string, unknown> | undefined;
    if (inner?.type === 'text' && typeof inner.text === 'string') {
      // An empty/whitespace-only text event (a tool-calls-only turn still
      // emits one) isn't nothing visually — it's a full-padding .tile-message
      // row with no visible content, reading as unexplained dead space
      // between the tool-call lines around it.
      if (!inner.text.trim()) return { role: outerRole, part: null };
      return classifySpecialText(inner.text) ?? { role: outerRole, part: { kind: 'text', text: inner.text } };
    }
    if ((inner?.type === 'tool-call' || inner?.type === 'tool_use') && typeof inner.name === 'string') {
      if (HIDDEN_TOOL_NAMES.has(inner.name)) return { role: outerRole, part: null };
      const input = (inner.input ?? inner.args ?? {}) as Record<string, unknown>;
      return { role: outerRole, part: toolCallPart({ name: inner.name, args: input }) };
    }
    if (inner?.type === 'event') return classifyLegacyEvent(outerRole, (inner.data ?? {}) as Record<string, unknown>);
    return { role: outerRole, part: { kind: 'raw', text: `<${String(inner?.type ?? 'unknown')}>` } };
  }

  if (record.role === 'session') {
    const inner = record.content as Record<string, unknown> | undefined;
    // A session-protocol envelope (happy-wire's SessionEnvelope) carries its
    // own role separately from this outer wrapper — text typed directly
    // into the CLI's own terminal arrives this way (the local-transcript
    // scanner mirrors it as role:'session' with an inner role:'user'
    // envelope), not as a plain role:'user' message like something sent
    // through happydeck itself.
    const envelopeRole = inner?.role === 'user' ? 'user' : 'agent';
    const ev = inner?.ev as Record<string, unknown> | undefined;
    const evType = String(ev?.t);
    if (HIDDEN_SESSION_EVENTS.has(evType)) return { role: envelopeRole, part: null };
    if (ev?.t === 'text' && typeof ev.text === 'string') {
      if (!ev.text.trim()) return { role: envelopeRole, part: null };
      return classifySpecialText(ev.text) ?? { role: envelopeRole, part: { kind: 'text', text: ev.text } };
    }
    if (ev?.t === 'service' && typeof ev.text === 'string') {
      return { role: envelopeRole, part: { kind: 'raw', text: ev.text } };
    }
    if (ev?.t === 'file' && typeof ev.name === 'string') {
      return {
        role: envelopeRole,
        part: {
          kind: 'file',
          name: ev.name,
          ref: typeof ev.ref === 'string' ? ev.ref : null,
          size: typeof ev.size === 'number' ? ev.size : null,
          mimeType: typeof ev.mimeType === 'string' ? ev.mimeType : null,
        },
      };
    }
    if (ev?.t === 'tool-call-start') {
      if (typeof ev.name === 'string' && HIDDEN_TOOL_NAMES.has(ev.name)) return { role: envelopeRole, part: null };
      return { role: envelopeRole, part: toolCallPart(ev) };
    }
    return { role: envelopeRole, part: { kind: 'raw', text: `[${evType}]` } };
  }

  return { role: 'system', part: { kind: 'raw', text: truncate(JSON.stringify(content), 200) } };
}

/**
 * Parses a decrypted message's content (legacy user/agent shape or the
 * newer session-envelope shape) into a renderable part, or null if it's
 * pure protocol noise (turn markers, the change-title side effect) not
 * worth a line in the transcript.
 */
export function renderablePart(content: unknown): RenderablePart | null {
  return classify(content).part;
}

export function messageRole(content: unknown): 'user' | 'agent' | 'system' {
  return classify(content).role;
}
