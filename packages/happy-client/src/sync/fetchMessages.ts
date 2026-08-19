import type { HttpClient } from '../api/http';
import { decodeBase64 } from '../crypto/base64';
import type { Decryptor, Encryptor } from '../crypto/encryptor';

// Int4 max, per the server's sentinel for "give me the latest page".
const SEQ_BACKWARD_INITIAL_SENTINEL = 2_147_483_647;

// Server-documented default/max for this endpoint (see .claude/plans —
// "既定100・最大500"). The client-side default here matches the server's
// own default rather than an arbitrarily smaller number: fetching only 20
// messages per session at bootstrap meant almost any real session's actual
// history started out of reach with no way to get to it — see
// fetchOlderMessages below for how a session with more than this reaches
// its earlier messages.
const DEFAULT_PAGE_LIMIT = 100;

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

export interface MessagesPage {
  /** Oldest-first, matching how callers append/prepend into a running transcript. */
  messages: DecryptedMessage[];
  /** True if there are still-older messages beyond this page (server-reported, not inferred from page size). */
  hasMore: boolean;
}

async function fetchMessagesPage(
  http: HttpClient,
  encryptor: Encryptor & Decryptor,
  sessionId: string,
  beforeSeq: number,
  limit: number,
): Promise<MessagesPage> {
  const query = new URLSearchParams({ before_seq: String(beforeSeq), limit: String(limit) });
  const response = await http.get<MessagesResponse>(`/v3/sessions/${sessionId}/messages?${query.toString()}`);

  const encryptedBlobs = response.messages.map((message) => decodeBase64(message.content.c, 'base64'));
  const decryptedContents = await encryptor.decrypt(encryptedBlobs);

  const messages = response.messages
    .map((message, index) => ({
      id: message.id,
      seq: message.seq,
      createdAt: message.createdAt,
      content: decryptedContents[index] ?? null,
    }))
    .reverse();

  return { messages, hasMore: response.hasMore };
}

/** The newest page of a session's messages — what bootstrap loads initially. */
export function fetchLatestMessages(
  http: HttpClient,
  encryptor: Encryptor & Decryptor,
  sessionId: string,
  limit = DEFAULT_PAGE_LIMIT,
): Promise<MessagesPage> {
  return fetchMessagesPage(http, encryptor, sessionId, SEQ_BACKWARD_INITIAL_SENTINEL, limit);
}

// The server's documented max for this endpoint (.claude/plans — "既定100・
// 最大500"). An explicit "load older" click is a deliberate ask for more
// history (unlike the fast-first-paint bootstrap load above), and a raw
// page this size still nets out to a much smaller VISIBLE page after
// renderablePart filters out protocol noise (turn markers, tool-call-end)
// — so the default page size read as "barely loads anything more" per click.
const OLDER_PAGE_LIMIT = 500;

/** The page immediately older than `oldestLoadedSeq` — for a "load older messages" action once the newest page's `hasMore` is true. */
export function fetchOlderMessages(
  http: HttpClient,
  encryptor: Encryptor & Decryptor,
  sessionId: string,
  oldestLoadedSeq: number,
  limit = OLDER_PAGE_LIMIT,
): Promise<MessagesPage> {
  return fetchMessagesPage(http, encryptor, sessionId, oldestLoadedSeq, limit);
}
