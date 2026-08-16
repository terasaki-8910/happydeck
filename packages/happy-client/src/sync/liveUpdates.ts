import type { Socket } from 'socket.io-client';

/**
 * `update` envelope shape (see happy-wire's CoreUpdateContainer for the
 * subset that's zod-validated on the send side; the relay's push side is
 * the same shape but untyped here since M1 only needs to observe it).
 */
export interface UpdateEnvelope {
  id: string;
  seq: number;
  body: { t: string; [key: string]: unknown };
  createdAt: number;
}

export interface EphemeralEnvelope {
  type: string;
  [key: string]: unknown;
}

export interface RelayUpdateHandlers {
  onUpdate?: (update: UpdateEnvelope) => void;
  onEphemeral?: (ephemeral: EphemeralEnvelope) => void;
}

/** Subscribes to the two live-update event names the relay ever pushes to a user-scoped client. Returns an unsubscribe function. */
export function subscribeToRelayUpdates(socket: Socket, handlers: RelayUpdateHandlers): () => void {
  const updateHandler = (update: UpdateEnvelope) => handlers.onUpdate?.(update);
  const ephemeralHandler = (ephemeral: EphemeralEnvelope) => handlers.onEphemeral?.(ephemeral);
  socket.on('update', updateHandler);
  socket.on('ephemeral', ephemeralHandler);
  return () => {
    socket.off('update', updateHandler);
    socket.off('ephemeral', ephemeralHandler);
  };
}
