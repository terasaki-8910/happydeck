import type { LiveSession } from '../store/happyStore';

/**
 * A hidden "side chat" forked from another session (happy-wire's
 * storageTypes.ts: "Side chats never appear in the top-level session list —
 * they render only inside the parent session's sidebar panel"). happydeck
 * has no such per-session panel yet, so for now this only means: don't
 * clutter the top-level list with it — matches the reference app's own
 * behavior rather than introducing new UI.
 */
export function isSideChat(session: LiveSession): boolean {
  return Boolean((session.metadata as { isSideChat?: boolean } | null)?.isSideChat);
}
