import { randomUUID } from "node:crypto";
import type { PublicUser, LoginBody, RegisterBody } from "@vc/shared";
import type { PasswordHasher } from "./passwordHasher";
import { generateRefreshToken, hashRefreshToken, type TokenService } from "./tokens";
import type { RefreshTokenRepository, UserRecord, UserRepository } from "./types";

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface Session {
  user: PublicUser;
  accessToken: string;
  expiresAt: number;
  refreshToken: string;
  refreshExpiresAt: number;
}

export interface AuthServiceDeps {
  users: UserRepository;
  refreshTokens: RefreshTokenRepository;
  hasher: PasswordHasher;
  tokens: TokenService;
  refreshTtlMs?: number;
  /** A just-rotated token used again within this window is a race (two tabs), not theft. */
  refreshGraceMs?: number;
  now?: () => number;
}

const toPublic = (u: UserRecord): PublicUser => ({ id: u.id, email: u.email, displayName: u.displayName });

export class AuthService {
  private readonly refreshTtlMs: number;
  private readonly graceMs: number;
  private readonly now: () => number;
  private dummyHash: Promise<string> | null = null;

  constructor(private readonly deps: AuthServiceDeps) {
    this.refreshTtlMs = deps.refreshTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.graceMs = deps.refreshGraceMs ?? 10_000;
    this.now = deps.now ?? Date.now;
  }

  async register(input: RegisterBody): Promise<Session> {
    const user: UserRecord = {
      id: randomUUID(),
      email: input.email,
      displayName: input.displayName,
      passwordHash: await this.deps.hasher.hash(input.password),
      createdAt: this.now(),
    };
    if (!(await this.deps.users.create(user))) {
      throw new AuthError(409, "email_taken", "An account with this email already exists.");
    }
    return this.issueSession(user, randomUUID());
  }

  async login(input: LoginBody): Promise<Session> {
    const user = await this.deps.users.findByEmail(input.email);
    // Always run a hash comparison, so a missing account takes as long as a wrong password.
    const hash = user?.passwordHash ?? (await this.getDummyHash());
    const ok = await this.deps.hasher.verify(hash, input.password);
    if (!user || !ok) throw new AuthError(401, "invalid_credentials", "Incorrect email or password.");
    return this.issueSession(user, randomUUID());
  }

  /** Swaps a refresh token for a new session. Each token works exactly once. */
  async refresh(rawToken: string | undefined): Promise<Session> {
    if (!rawToken) throw new AuthError(401, "no_session", "Sign in to continue.");

    const record = await this.deps.refreshTokens.findByHash(hashRefreshToken(rawToken));
    if (!record) throw new AuthError(401, "invalid_session", "Your session has ended. Sign in again.");

    const now = this.now();
    if (record.expiresAt <= now) throw new AuthError(401, "session_expired", "Your session has expired. Sign in again.");

    if (record.revokedAt !== null) {
      if (record.rotatedAt !== null && now - record.rotatedAt < this.graceMs) {
        throw new AuthError(401, "refresh_in_progress", "Session is being refreshed. Try again.");
      }
      // A used or logged-out token came back: assume it leaked and end the whole family.
      await this.deps.refreshTokens.revokeFamily(record.familyId, now);
      throw new AuthError(401, "session_revoked", "Your session has ended. Sign in again.");
    }

    const user = await this.deps.users.findById(record.userId);
    if (!user) throw new AuthError(401, "invalid_session", "Your session has ended. Sign in again.");

    await this.deps.refreshTokens.update(record.id, { revokedAt: now, rotatedAt: now });
    return this.issueSession(user, record.familyId);
  }

  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;
    const record = await this.deps.refreshTokens.findByHash(hashRefreshToken(rawToken));
    if (record) await this.deps.refreshTokens.revokeFamily(record.familyId, this.now());
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.deps.users.findById(userId);
    if (!user) throw new AuthError(401, "unauthorized", "Sign in to continue.");
    return toPublic(user);
  }

  private async issueSession(user: UserRecord, familyId: string): Promise<Session> {
    const refreshToken = generateRefreshToken();
    const refreshExpiresAt = this.now() + this.refreshTtlMs;
    await this.deps.refreshTokens.save({
      id: randomUUID(),
      userId: user.id,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: refreshExpiresAt,
      revokedAt: null,
      rotatedAt: null,
    });
    const { token, expiresAt } = await this.deps.tokens.signAccess(user);
    return { user: toPublic(user), accessToken: token, expiresAt, refreshToken, refreshExpiresAt };
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.deps.hasher.hash(randomUUID());
    return this.dummyHash;
  }
}
