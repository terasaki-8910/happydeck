import type { HttpClient } from '../api/http';
import { encodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';

export interface SendMessageMeta {
  sentFrom?: string;
  permissionMode?: string;
  model?: string;
  modelProviderId?: string;
  effort?: string;
  displayText?: string;
}

interface SendMessageResponseRow {
  id: string;
  seq: number;
  localId: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Sends a plain user text message to a session (POST .../messages — an
 * HTTP call, not a socket RPC to the agent; the agent picks it up via the
 * relay same as any other client would). Does not itself change the
 * session's standing permissionMode/model/effort — those persist via
 * updateSessionAgentModes (agentModes.ts) and apply to future turns
 * regardless of what any single message's `meta` carries.
 */
export async function sendSessionMessage(
  http: HttpClient,
  sessionId: string,
  encryptor: Encryptor & Decryptor,
  text: string,
  meta: SendMessageMeta = {},
): Promise<SendMessageResponseRow> {
  const localId = crypto.randomUUID();
  const content = {
    role: 'user',
    content: { type: 'text', text },
    meta: { sentFrom: 'ccdeck', ...meta },
  };
  const [encryptedBytes] = await encryptor.encrypt([content]);

  const response = await http.post<{ messages: SendMessageResponseRow[] }>(`/v3/sessions/${sessionId}/messages`, {
    messages: [{ localId, content: encodeBase64(encryptedBytes, 'base64') }],
  });

  const row = response.messages[0];
  if (!row) {
    throw new Error('Send message response did not include the created row');
  }
  return row;
}
