import { messageRole, renderablePart } from './formatMessage';
import type { LiveSession } from '../store/happyStore';
import { deriveTitle } from './sessionTitle';

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SearchResult {
  session: LiveSession;
  title: string;
  host: string | undefined;
  /** What matched — a message's own text, or the session's title/path itself. */
  snippet: SearchSnippet;
  /** For sorting only — the matched message's timestamp, or the session's own updatedAt for a title/path match. */
  matchedAt: number;
}

const SNIPPET_RADIUS = 60;
const MAX_RESULTS = 50;
const MAX_PER_SESSION = 3;

function snippetAround(text: string, index: number, matchLength: number): SearchSnippet {
  const oneLine = text.replace(/\s+/g, ' ');
  // index/matchLength were computed against the whitespace-collapsed form
  // by the caller, so they stay valid after this replace.
  const start = Math.max(0, index - SNIPPET_RADIUS);
  const end = Math.min(oneLine.length, index + matchLength + SNIPPET_RADIUS);
  return {
    before: (start > 0 ? '…' : '') + oneLine.slice(start, index),
    match: oneLine.slice(index, index + matchLength),
    after: oneLine.slice(index + matchLength, end) + (end < oneLine.length ? '…' : ''),
  };
}

function wholeStringSnippet(text: string): SearchSnippet {
  return { before: '', match: '', after: text };
}

/**
 * Client-side substring search over already-fetched session data (titles,
 * paths, message text) — deliberately not a server query, so it works the
 * same for a session on a currently-offline machine as one that's live
 * (there's nothing to search on a dead connection otherwise).
 */
export function searchSessions(sessions: LiveSession[], rawQuery: string): SearchResult[] {
  const query = rawQuery.trim().toLowerCase();
  if (!query) return [];

  const results: SearchResult[] = [];

  for (const session of sessions) {
    const metadata = session.metadata as { path?: string; host?: string } | null;
    const path = metadata?.path ?? session.id;
    const title = deriveTitle(session.metadata, session.messages) ?? path;
    const host = metadata?.host;
    let countForSession = 0;

    const titleLower = title.toLowerCase();
    const titleIndex = titleLower.indexOf(query);
    if (titleIndex !== -1) {
      results.push({ session, title, host, matchedAt: session.updatedAt, snippet: snippetAround(title, titleIndex, query.length) });
      countForSession++;
    }

    if (countForSession < MAX_PER_SESSION && path !== title && path.toLowerCase().includes(query)) {
      results.push({ session, title, host, matchedAt: session.updatedAt, snippet: wholeStringSnippet(path) });
      countForSession++;
    }

    for (let i = session.messages.length - 1; i >= 0 && countForSession < MAX_PER_SESSION; i--) {
      const message = session.messages[i];
      const part = renderablePart(message.content);
      // A task-notification's role is 'system' (see formatMessage.ts —
      // that's the correct fix for its wrong-bubble rendering), but its
      // <result> body is real content worth finding — the entire output of
      // a background agent, not protocol chatter. So it's carved out of the
      // system-role skip below rather than excluded along with it.
      let haystack: string | null = null;
      if (part?.kind === 'task-notification') {
        haystack = [part.headline, part.body].filter(Boolean).join('\n');
      } else if (part?.kind === 'text' && messageRole(message.content) !== 'system') {
        haystack = part.text;
      }
      if (!haystack) continue;
      const oneLine = haystack.replace(/\s+/g, ' ');
      const index = oneLine.toLowerCase().indexOf(query);
      if (index === -1) continue;
      results.push({ session, title, host, matchedAt: message.createdAt, snippet: snippetAround(haystack, index, query.length) });
      countForSession++;
    }
  }

  results.sort((a, b) => b.matchedAt - a.matchedAt);
  return results.slice(0, MAX_RESULTS);
}
