import type { HttpClient } from '../api/http';
import { decodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';

// Int4 max, per the server's sentinel for "give me the latest page".
const SEQ_BACKWARD_INITIAL_SENTINEL = 2_147_483_647;

interface RawMessage {
  id: string;
  seq: number;
  localId?: string | null;
  content: { c: string; t: 'encrypted' };
  createdAt: number;
  updatedAt: number;
}

interface MessagesResponse {
  messages: RawMessage[];
  hasMore: boolean;
}

export interface DecryptedMessage {
  id: string;
  seq: number;
  createdAt: number;
  /** null if this record failed to decrypt (wrong key, corrupted data, etc). */
  content: unknown | null;
}

async function fetchAndDecrypt(
  http: HttpClient,
  encryptor: Encryptor & Decryptor,
  sessionId: string,
  query: URLSearchParams,
): Promise<DecryptedMessage[]> {
  const response = await http.get<MessagesResponse>(`/v3/sessions/${sessionId}/messages?${query.toString()}`);

  const encryptedBlobs = response.messages.map((message) => decodeBase64(message.content.c, 'base64'));
  const decryptedContents = await encryptor.decrypt(encryptedBlobs);

  return response.messages.map((message, index) => ({
    id: message.id,
    seq: message.seq,
    createdAt: message.createdAt,
    content: decryptedContents[index] ?? null,
  }));
}

/**
 * Fetches the newest `limit` messages of a session (GET .../messages?before_seq=<max>)
 * and decrypts them with the session's own encryptor (get it from
 * `encryption.openEncryption(session.dataKey)`, using the `dataKey` returned
 * by fetchSessions for that same session — NOT a fresh lookup).
 */
export async function fetchLatestMessages(
  http: HttpClient,
  encryptor: Encryptor & Decryptor,
  sessionId: string,
  limit = 20,
): Promise<DecryptedMessage[]> {
  return fetchAndDecrypt(
    http,
    encryptor,
    sessionId,
    new URLSearchParams({ before_seq: String(SEQ_BACKWARD_INITIAL_SENTINEL), limit: String(limit) }),
  );
}

/**
 * Fetches the OLDEST `limit` messages of a session (GET .../messages?after_seq=0).
 * Session titles (the `mcp__happy__change_title` tool call) are almost
 * always set within the first few agent turns, so this is the cheap way to
 * find one without paging through a session's entire history.
 */
export async function fetchEarliestMessages(
  http: HttpClient,
  encryptor: Encryptor & Decryptor,
  sessionId: string,
  limit = 10,
): Promise<DecryptedMessage[]> {
  return fetchAndDecrypt(http, encryptor, sessionId, new URLSearchParams({ after_seq: '0', limit: String(limit) }));
}
