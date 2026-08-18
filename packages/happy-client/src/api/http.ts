import { getHappyClientId } from './happyClientId';
import { getServerUrl } from './serverConfig';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`HTTP ${status}: ${body}`);
  }
}

/**
 * Thrown when a request never got a response within REQUEST_TIMEOUT_MS.
 * `fetch()` has no default timeout of its own — a dropped connection, a
 * server that's up but not answering, or a VPN/Tailscale hiccup all hang
 * the returned promise forever otherwise, which is exactly what left the
 * app stuck on "connecting…" indefinitely with no way to recover short of
 * force-quitting (confirmed: this is what happened).
 */
export class HttpTimeoutError extends Error {
  constructor(path: string) {
    super(`Request to ${path} timed out`);
  }
}

const REQUEST_TIMEOUT_MS = 15_000;

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

/**
 * Authenticated REST client for the Happy relay. `token` is looked up
 * lazily on every call (not just once at construction) so a token minted
 * via auth/token.ts mid-session is picked up without re-creating the
 * client — mirrors apiSocket.ts always re-reading TokenStorage per request.
 */
export class HttpClient {
  constructor(private readonly getToken: () => string) {}

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const url = `${getServerUrl()}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.getToken()}`,
      'X-Happy-Client': getHappyClientId(),
      ...(init.headers as Record<string, string> | undefined),
    };
    try {
      return await fetch(url, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'TimeoutError') {
        throw new HttpTimeoutError(path);
      }
      throw error;
    }
  }

  async get<T>(path: string): Promise<T> {
    const response = await this.request(path, { method: 'GET' });
    if (!response.ok) {
      throw new HttpError(response.status, await safeText(response));
    }
    return (await response.json()) as T;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const response = await this.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new HttpError(response.status, await safeText(response));
    }
    return (await response.json()) as T;
  }

  /** Some DELETE endpoints (e.g. session delete) respond 204/empty — tolerate that instead of forcing response.json(). */
  async delete<T = void>(path: string): Promise<T> {
    const response = await this.request(path, { method: 'DELETE' });
    if (!response.ok) {
      throw new HttpError(response.status, await safeText(response));
    }
    const text = await safeText(response);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
