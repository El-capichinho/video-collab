import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export interface LinkClaims {
  fileId: string;
  roomId: string;
  userId: string;
}

export interface DownloadLinkOptions {
  secret?: Buffer;
  ttlMs?: number;
  now?: () => number;
}

/**
 * Short-lived, signed download links. A browser can't attach an Authorization header
 * to a plain download, so the client asks (authenticated) for a link that works for
 * one person, one file, for about a minute. The same idea as S3 pre-signed URLs.
 */
export class DownloadLinks {
  private readonly secret: Buffer;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: DownloadLinkOptions = {}) {
    // A fresh secret per run is fine: links only live for a minute anyway.
    this.secret = options.secret ?? randomBytes(32);
    this.ttlMs = options.ttlMs ?? 60_000;
    this.now = options.now ?? Date.now;
  }

  create(claims: LinkClaims): string {
    const payload = Buffer.from(JSON.stringify({ ...claims, exp: this.now() + this.ttlMs })).toString("base64url");
    return `${payload}.${this.sign(payload)}`;
  }

  /** The claims, or null if the token is forged, malformed, or expired. */
  verify(token: string): LinkClaims | null {
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, signature] = parts as [string, string];

    const given = Buffer.from(signature);
    const expected = Buffer.from(this.sign(payload));
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;

    try {
      const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
      if (typeof data.exp !== "number" || data.exp < this.now()) return null;
      const { fileId, roomId, userId } = data;
      if (typeof fileId !== "string" || typeof roomId !== "string" || typeof userId !== "string") return null;
      return { fileId, roomId, userId };
    } catch {
      return null;
    }
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.secret).update(payload).digest("base64url");
  }
}
