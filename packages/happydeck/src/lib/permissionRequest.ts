import type { PendingPermissionRequest } from '../store/happyStore';
import type { Language } from '../store/settingsStore';

/**
 * `request.arguments` has no typed shape anywhere in this codebase (or the
 * upstream protocol) — it's `unknown` end to end. This only recognizes the
 * one shape that matters for Bash (needed below to build a safe
 * always-allow pattern anyway) plus a few common field names for other
 * tools, on a best-effort basis, rather than attempting per-tool rendering.
 */
export function describePendingRequest(request: PendingPermissionRequest): string | null {
  if (request.tool === 'Bash') {
    return bashCommand(request);
  }
  const args = request.arguments as Record<string, unknown> | null | undefined;
  if (args && typeof args === 'object') {
    for (const key of ['file_path', 'path', 'pattern', 'url']) {
      const value = args[key];
      if (typeof value === 'string') return value;
    }
  }
  return null;
}

function bashCommand(request: PendingPermissionRequest): string | null {
  const args = request.arguments as { command?: unknown } | null | undefined;
  return typeof args?.command === 'string' ? args.command : null;
}

/**
 * The first real command token of a Bash invocation, for building an
 * always-allow pattern — e.g. `FOO=bar git status --short` -> `git`.
 * Strips leading `NAME=value` env-var assignments first (a common prefix
 * that would otherwise get mistaken for the command itself). Returns null
 * on anything ambiguous (empty after stripping) rather than guessing —
 * an always-allow grant this can't confidently characterize should not be
 * offered at all, not offered with a made-up pattern.
 */
function bashCommandPrefix(command: string): string | null {
  const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const commandToken = tokens.find((token) => !ASSIGNMENT.test(token));
  if (!commandToken) return null;
  // Strip shell metacharacters glued onto the token with no surrounding
  // whitespace (e.g. "git;rm" as one token) so those can't ride along as
  // part of the "safe" prefix.
  const match = commandToken.match(/^([^;&|<>]+)/);
  return match ? match[1] : null;
}

export interface AlwaysAllowGrant {
  /** Passed straight through to happy-client's sessionAllow as `allowedTools`. */
  allowedTools: string[];
  /** Precise, human-readable scope — a broader-than-one-call grant needs this spelled out, not just a bare "always allow" label. */
  scopeDescription: string;
}

/**
 * What an "always allow" click on this request would actually grant, or
 * null if this request can't be safely characterized (e.g. a Bash command
 * with no recognizable first token) — in which case the caller should not
 * offer the button at all rather than fall back to a guess.
 *
 * Bash needs its own pattern (`Bash(<prefix>:*)`) because happy-cli's
 * permission handler special-cases the bare string "Bash" as a silent
 * no-op — confirmed by reading its installed source directly (2026-09-02
 * investigation) — while every other tool is satisfied by its bare name.
 * Deliberately narrower than "allow all Bash": scoping to the first
 * command word (git/npm/etc.) rather than every command is what actually
 * matches what a user asking for this wants ("stop asking about git"),
 * without also silently covering unrelated destructive commands
 * (rm, sudo, ...) that were never explicitly approved.
 */
export function alwaysAllowGrant(request: PendingPermissionRequest, language: Language): AlwaysAllowGrant | null {
  if (request.tool === 'Bash') {
    const command = bashCommand(request);
    const prefix = command ? bashCommandPrefix(command) : null;
    if (!prefix) return null;
    return {
      allowedTools: [`Bash(${prefix}:*)`],
      scopeDescription:
        language === 'ja'
          ? `今後「${prefix}」で始まるコマンドは、このセッション中は確認なしで許可します。`
          : `Allows every future "${prefix} ..." command for the rest of this session, without asking again.`,
    };
  }
  return {
    allowedTools: [request.tool],
    scopeDescription:
      language === 'ja' ? `今後の${request.tool}のリクエストは、このセッション中は確認なしで許可します。` : `Allows every future ${request.tool} request for the rest of this session, without asking again.`,
  };
}
