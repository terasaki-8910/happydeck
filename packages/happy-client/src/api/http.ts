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
    return fetch(url, { ...init, headers });
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
}
