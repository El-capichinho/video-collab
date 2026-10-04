import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  createHash,
  type KeyObject,
} from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { SignJWT, jwtVerify } from "jose";

const ISSUER = "video-collab";
const AUDIENCE = "video-collab-api";

export interface TokenUser {
  id: string;
  displayName: string;
}

export interface TokenServiceOptions {
  accessTtlSeconds?: number;
}

/** Signs and verifies short-lived access tokens (JWT, EdDSA / Ed25519). */
export class TokenService {
  private readonly ttl: number;

  constructor(
    private readonly privateKey: KeyObject,
    private readonly publicKey: KeyObject,
    options: TokenServiceOptions = {},
  ) {
    this.ttl = options.accessTtlSeconds ?? 600; // 10 minutes
  }

  static generate(options?: TokenServiceOptions): TokenService {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    return new TokenService(privateKey, publicKey, options);
  }

  static fromPem(pem: string, options?: TokenServiceOptions): TokenService {
    const privateKey = createPrivateKey(pem);
    return new TokenService(privateKey, createPublicKey(privateKey), options);
  }

  exportPrivatePem(): string {
    return this.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  }

  async signAccess(user: TokenUser): Promise<{ token: string; expiresAt: number }> {
    const iat = Math.floor(Date.now() / 1000);
    const exp = iat + this.ttl;
    const token = await new SignJWT({ name: user.displayName })
      .setProtectedHeader({ alg: "EdDSA" })
      .setSubject(user.id)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .setJti(randomUUID())
      .sign(this.privateKey);
    return { token, expiresAt: exp * 1000 };
  }

  /** Throws if the token is forged, expired, or meant for someone else. */
  async verifyAccess(token: string): Promise<TokenUser> {
    const { payload } = await jwtVerify(token, this.publicKey, {
      algorithms: ["EdDSA"], // pinned: rejects "alg: none" and algorithm-swap attacks
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (!payload.sub || typeof payload.name !== "string") throw new Error("Malformed token");
    return { id: payload.sub, displayName: payload.name };
  }
}

/**
 * Key from JWT_PRIVATE_KEY (production), else a key file (development).
 * If neither exists, one is generated and saved so tokens survive restarts.
 */
export function loadTokenService(opts: { pem?: string; keyFile: string }): TokenService {
  if (opts.pem) return TokenService.fromPem(opts.pem.replace(/\\n/g, "\n"));
  if (existsSync(opts.keyFile)) return TokenService.fromPem(readFileSync(opts.keyFile, "utf8"));

  const service = TokenService.generate();
  mkdirSync(dirname(opts.keyFile), { recursive: true });
  writeFileSync(opts.keyFile, service.exportPrivatePem(), { mode: 0o600 });
  console.warn(`Generated a development signing key at ${opts.keyFile}. Set JWT_PRIVATE_KEY in production.`);
  return service;
}

/** Refresh tokens are random, opaque strings. Only their hash is stored. */
export const generateRefreshToken = () => randomBytes(32).toString("base64url");
export const hashRefreshToken = (token: string) => createHash("sha256").update(token).digest("hex");
