import type { AuthResponse, LoginBody, PublicUser, RegisterBody } from "@vc/shared";

export class AuthApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Listener = (user: PublicUser | null) => void;

/** Renew this long before expiry so a token never dies mid-request. */
const REFRESH_MARGIN_MS = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Talks to /auth. The access token lives only in memory (never localStorage), so a
 * script injected into the page can't read a long-lived credential. The refresh token
 * is an HTTP-only cookie the browser manages; this class never sees it.
 */
export class AuthClient {
  private accessToken: string | null = null;
  private expiresAt = 0;
  private user: PublicUser | null = null;
  private inflight: Promise<PublicUser | null> | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly fetchFn: typeof fetch;
  private readonly retryDelayMs: number;

  constructor(
    private readonly baseUrl: string,
    options: { fetchFn?: typeof fetch; retryDelayMs?: number } = {},
  ) {
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
    this.retryDelayMs = options.retryDelayMs ?? 300;
  }

  get currentUser(): PublicUser | null {
    return this.user;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async register(input: RegisterBody): Promise<PublicUser> {
    return this.apply(await this.request("/auth/register", input));
  }

  async login(input: LoginBody): Promise<PublicUser> {
    return this.apply(await this.request("/auth/login", input));
  }

  async logout(): Promise<void> {
    try {
      await this.request("/auth/logout");
    } catch {
      /* even if the server is unreachable, forget the session locally */
    } finally {
      this.clear();
    }
  }

  /** Asks the server whether the refresh cookie still gives us a session. */
  restoreSession(): Promise<PublicUser | null> {
    return this.refresh();
  }

  /** A valid access token, renewing it first if it is about to expire. */
  readonly getAccessToken = async (): Promise<string> => {
    if (this.accessToken && this.expiresAt - Date.now() > REFRESH_MARGIN_MS) return this.accessToken;
    await this.refresh();
    if (!this.accessToken) throw new AuthApiError("Your session has ended. Sign in again.", "signed_out", 401);
    return this.accessToken;
  };

  /**
   * Single-flight: concurrent callers share one request. Refresh tokens are one-time,
   * so two simultaneous refreshes would look like token theft to the server.
   */
  private refresh(): Promise<PublicUser | null> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async doRefresh(): Promise<PublicUser | null> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return this.apply(await this.request("/auth/refresh"));
      } catch (error) {
        // Another tab is mid-rotation and has just set a newer cookie: try again once.
        if (error instanceof AuthApiError && error.code === "refresh_in_progress" && attempt === 0) {
          await sleep(this.retryDelayMs);
          continue;
        }
        if (error instanceof AuthApiError && error.status === 401) {
          this.clear();
          return null;
        }
        throw error; // network or server trouble: don't sign the user out for it
      }
    }
    this.clear();
    return null;
  }

  private async request(path: string, body?: unknown): Promise<AuthResponse | null> {
    const response = await this.fetchFn(this.baseUrl + path, {
      method: "POST",
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AuthApiError(
        data?.error?.message ?? "Something went wrong. Try again.",
        data?.error?.code ?? "unknown",
        response.status,
      );
    }
    return data as AuthResponse;
  }

  private apply(response: AuthResponse | null): PublicUser {
    if (!response) throw new AuthApiError("Unexpected empty response.", "unknown", 500);
    this.accessToken = response.accessToken;
    this.expiresAt = response.expiresAt;
    this.user = response.user;
    this.listeners.forEach((l) => l(this.user));
    return response.user;
  }

  private clear(): void {
    const hadUser = this.user !== null;
    this.accessToken = null;
    this.expiresAt = 0;
    this.user = null;
    if (hadUser) this.listeners.forEach((l) => l(null));
  }
}
