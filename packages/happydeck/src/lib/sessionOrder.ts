import type { LiveSession } from '../store/happyStore';

/** Last message time if any, else the server's activeAt — used to sort the sidebar and to pick a default focus session. */
function lastActivityOf(session: LiveSession): number {
  const lastMessage = session.messages[session.messages.length - 1];
  return lastMessage?.createdAt ?? session.activeAt;
}

export function byRecency(sessions: LiveSession[]): LiveSession[] {
  return [...sessions].sort((a, b) => lastActivityOf(b) - lastActivityOf(a));
}

export function mostRecentSession(sessions: LiveSession[]): LiveSession | null {
  return byRecency(sessions)[0] ?? null;
}
