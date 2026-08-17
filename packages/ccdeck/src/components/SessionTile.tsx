import type { LiveSession } from '../store/happyStore';
import { messageRole, summarizeMessageContent } from '../lib/formatMessage';

interface SessionTileProps {
  session: LiveSession;
}

function statusOf(session: LiveSession): { label: string; className: string } {
  if (!session.active) {
    return { label: 'offline', className: 'status-offline' };
  }
  if (session.thinking) {
    return { label: 'thinking', className: 'status-thinking' };
  }
  return { label: 'online', className: 'status-online' };
}

export function SessionTile({ session }: SessionTileProps) {
  const status = statusOf(session);
  const path = (session.metadata as { path?: string } | null)?.path ?? session.id;

  return (
    <section className="tile">
      <header className="tile-header">
        <span className={`status-dot ${status.className}`} />
        <span className="tile-path" title={path}>
          {path}
        </span>
        <span className="tile-status-label">{status.label}</span>
      </header>
      <div className="tile-messages">
        {session.messages.length === 0 && <p className="tile-empty">(no messages)</p>}
        {session.messages.map((message) => (
          <p key={message.id} className={`tile-message role-${messageRole(message.content)}`}>
            {summarizeMessageContent(message.content)}
          </p>
        ))}
      </div>
    </section>
  );
}
