import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RefreshRecord, RefreshTokenRepository, UserRecord, UserRepository } from "./types";

interface Snapshot {
  users: UserRecord[];
  refreshTokens: RefreshRecord[];
}

/**
 * Development store: in memory, optionally saved to a JSON file so accounts
 * survive restarts. Implements the repository interfaces, so swapping in
 * Postgres or MongoDB later means writing one new class.
 */
export class FileBackedStore implements UserRepository, RefreshTokenRepository {
  private users = new Map<string, UserRecord>();
  private userIdByEmail = new Map<string, string>();
  private tokens = new Map<string, RefreshRecord>();
  private tokenIdByHash = new Map<string, string>();

  constructor(private readonly filePath?: string) {
    if (filePath && existsSync(filePath)) {
      const snapshot = JSON.parse(readFileSync(filePath, "utf8")) as Snapshot;
      const now = Date.now();
      for (const u of snapshot.users) this.addUser(u);
      for (const t of snapshot.refreshTokens) if (t.expiresAt > now) this.addToken(t);
    }
  }

  async findByEmail(email: string) {
    const id = this.userIdByEmail.get(email);
    return id ? (this.users.get(id) ?? null) : null;
  }

  async findById(id: string) {
    return this.users.get(id) ?? null;
  }

  async create(user: UserRecord) {
    if (this.userIdByEmail.has(user.email)) return false;
    this.addUser(user);
    this.persist();
    return true;
  }

  async save(record: RefreshRecord) {
    this.addToken(record);
    this.persist();
  }

  async findByHash(tokenHash: string) {
    const id = this.tokenIdByHash.get(tokenHash);
    return id ? (this.tokens.get(id) ?? null) : null;
  }

  async update(id: string, patch: Partial<Pick<RefreshRecord, "revokedAt" | "rotatedAt">>) {
    const record = this.tokens.get(id);
    if (!record) return;
    Object.assign(record, patch);
    this.persist();
  }

  async revokeFamily(familyId: string, at: number) {
    for (const t of this.tokens.values()) {
      if (t.familyId === familyId && t.revokedAt === null) t.revokedAt = at;
    }
    this.persist();
  }

  private addUser(u: UserRecord) {
    this.users.set(u.id, u);
    this.userIdByEmail.set(u.email, u.id);
  }

  private addToken(t: RefreshRecord) {
    this.tokens.set(t.id, t);
    this.tokenIdByHash.set(t.tokenHash, t.id);
  }

  private persist() {
    if (!this.filePath) return;
    mkdirSync(dirname(this.filePath), { recursive: true });
    const snapshot: Snapshot = { users: [...this.users.values()], refreshTokens: [...this.tokens.values()] };
    const temp = `${this.filePath}.tmp`;
    writeFileSync(temp, JSON.stringify(snapshot), { mode: 0o600 });
    renameSync(temp, this.filePath); // atomic replace: a crash never leaves a half-written file
  }
}
