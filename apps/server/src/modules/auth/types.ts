export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  createdAt: number;
}

export interface RefreshRecord {
  id: string;
  userId: string;
  /** All tokens descended from one login share a family, so a stolen token can be cut off. */
  familyId: string;
  tokenHash: string;
  expiresAt: number;
  revokedAt: number | null;
  /** Set when the token was swapped for a new one (as opposed to logged out). */
  rotatedAt: number | null;
}

export interface UserRepository {
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  /** Returns false if the email is already taken. */
  create(user: UserRecord): Promise<boolean>;
}

export interface RefreshTokenRepository {
  save(record: RefreshRecord): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshRecord | null>;
  update(id: string, patch: Partial<Pick<RefreshRecord, "revokedAt" | "rotatedAt">>): Promise<void>;
  revokeFamily(familyId: string, at: number): Promise<void>;
}
