/**
 * A minimal commercetools REST client for the generator.
 *
 * Deliberately dependency-free (Node's fetch, no SDK): this is a dev tool, and keeping it
 * self-contained means it does not participate in the sync-shared machinery or carry the
 * platform SDK. It caches the OAuth token and refreshes it before expiry.
 */

export interface CtConfig {
  projectKey: string;
  clientId: string;
  clientSecret: string;
  authUrl: string;
  apiUrl: string;
}

export const readConfig = (env: NodeJS.ProcessEnv = process.env): CtConfig => {
  const required = ['CTP_PROJECT_KEY', 'CTP_CLIENT_ID', 'CTP_CLIENT_SECRET', 'CTP_AUTH_URL', 'CTP_API_URL'];
  const missing = required.filter((k) => !env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing env: ${missing.join(', ')}. Copy the sp-demo credentials into tools/event-generator/.env`);
  }
  return {
    projectKey: env.CTP_PROJECT_KEY as string,
    clientId: env.CTP_CLIENT_ID as string,
    clientSecret: env.CTP_CLIENT_SECRET as string,
    authUrl: (env.CTP_AUTH_URL as string).replace(/\/$/, ''),
    apiUrl: (env.CTP_API_URL as string).replace(/\/$/, ''),
  };
};

export class CtClient {
  private token: string | null = null;
  private tokenExpiry = 0;

  constructor(private readonly config: CtConfig) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiry - 30_000) return this.token;
    const auth = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    const response = await fetch(`${this.config.authUrl}/oauth/token`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!response.ok) throw new Error(`Auth failed: ${response.status} ${await response.text()}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    this.token = body.access_token;
    this.tokenExpiry = Date.now() + body.expires_in * 1000;
    return this.token;
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.accessToken();
    const response = await fetch(`${this.config.apiUrl}/${this.config.projectKey}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const text = await response.text();
    const parsed = text ? (JSON.parse(text) as T & { errors?: unknown[]; message?: string }) : ({} as T);
    if (!response.ok) {
      const detail =
        (parsed as { errors?: unknown[]; message?: string }).message ??
        JSON.stringify((parsed as { errors?: unknown[] }).errors ?? parsed);
      throw new Error(`${method} ${path} → ${response.status}: ${detail}`);
    }
    return parsed as T;
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }
  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }
}
