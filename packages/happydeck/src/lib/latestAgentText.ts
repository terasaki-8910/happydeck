import type { LiveSession } from '../store/happyStore';
import { messageRole, renderablePart } from './formatMessage';

/**
 * The most recent thing the agent actually SAID, as a single line.
 *
 * Deliberately only `kind === 'text'` from an `agent`-role message: tool
 * calls, local-command/bash stdout and background-task notices all
 * classify as something other than agent prose (see formatMessage.ts's
 * classify()), and none of them describe what the turn accomplished.
 *
 * Returns null when the session has no agent prose at all — a brand new
 * session, or one whose whole turn was tool calls. Callers decide their
 * own fallback rather than getting a misleading one baked in (the sidebar
 * wants the directory name; a notification wants something else).
 */
/**
 * Flattens markdown to something readable on a single line. Agent replies
 * are usually markdown, and collapsing one verbatim produces things like
 * "## Summary Here is what changed: | Area | Before | After | |---|---|"
 * — the syntax characters carry no meaning once the structure is gone, and
 * a table's pipes and rules actively crowd out the words.
 */
function flattenMarkdown(text: string): string {
  return text
    .split('\n')
    // A table's separator row is pure structure — nothing survives it.
    .filter((line) => !/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\s{0,3}#{1,6}\s+/, '') // heading markers
        .replace(/^\s*```.*$/, '') // fence lines
        .replace(/^\s*>\s?/, '') // blockquote markers
        .replace(/^\s*[-*+]\s+/, '') // bullet markers
        .replace(/^\s*\d+\.\s+/, '') // ordered-list markers
        .replace(/\|/g, ' ') // table cell separators
        .replace(/\*\*(.+?)\*\*/g, '$1') // bold
        .replace(/`([^`]+)`/g, '$1'), // inline code
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function latestAgentText(session: LiveSession, maxLength = 90): string | null {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i];
    if (messageRole(message.content) !== 'agent') continue;
    const part = renderablePart(message.content);
    if (part?.kind !== 'text') continue;
    const oneLine = flattenMarkdown(part.text);
    if (!oneLine) continue;
    return oneLine.length > maxLength ? `${oneLine.slice(0, maxLength)}…` : oneLine;
  }
  return null;
}
