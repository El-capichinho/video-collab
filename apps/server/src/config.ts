import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { IceConfig } from "./modules/rtc/iceServers";

export interface AppConfig {
  port: number;
  dataDir: string;
  production: boolean;
  /** Browser origins allowed to call the API, e.g. https://meet.example.com */
  origins: string[];
  jwtPrivateKey?: string;
  /** How many reverse proxies sit in front of the server. */
  trustProxy: number;
  ice: IceConfig;
  /** Things that work but are probably a mistake. Shown at startup. */
  warnings: string[];
}

/** Every problem found, so a misconfigured deployment is fixed in one go, not one error at a time. */
export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`The server isn't configured correctly:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  }
}

const list = (value: string | undefined) =>
  (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);

function integer(raw: string | undefined, name: string, min: number, max: number, fallback: number, problems: string[]): number {
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    problems.push(`${name} must be a whole number from ${min} to ${max} (got "${raw}").`);
    return fallback;
  }
  return n;
}

export function loadConfig(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
  cwd: string = process.cwd(),
): AppConfig {
  const problems: string[] = [];
  const warnings: string[] = [];
  const production = env.NODE_ENV === "production";

  const port = integer(env.PORT, "PORT", 1, 65535, 4000, problems);
  const trustProxy = integer(env.TRUST_PROXY, "TRUST_PROXY", 0, 10, 0, problems);
  const ttlSeconds = integer(env.TURN_TTL_SECONDS, "TURN_TTL_SECONDS", 60, 86_400, 6 * 60 * 60, problems);

  // ---- allowed browser origins ----
  const given = list(env.CLIENT_ORIGIN);
  if (production && given.length === 0) {
    problems.push("CLIENT_ORIGIN is required in production: the address people open, e.g. https://meet.example.com");
  }
  const origins = given.length > 0 ? given : production ? [] : ["http://localhost:5173", "http://127.0.0.1:5173"];
  for (const origin of origins) {
    let parsed: URL | null = null;
    try {
      parsed = new URL(origin);
    } catch {
      /* reported below */
    }
    if (!parsed || parsed.origin !== origin) {
      problems.push(`CLIENT_ORIGIN "${origin}" must be just an origin like https://meet.example.com (no path, no trailing slash).`);
    } else if (production && parsed.protocol !== "https:") {
      problems.push(`CLIENT_ORIGIN "${origin}" must use https:// in production: browsers won't give camera access otherwise.`);
    }
  }

  // ---- signing key ----
  let jwtPrivateKey = env.JWT_PRIVATE_KEY;
  if (jwtPrivateKey && env.JWT_PRIVATE_KEY_FILE) {
    problems.push("Set JWT_PRIVATE_KEY or JWT_PRIVATE_KEY_FILE, not both.");
  } else if (env.JWT_PRIVATE_KEY_FILE) {
    try {
      jwtPrivateKey = readFile(env.JWT_PRIVATE_KEY_FILE);
    } catch {
      problems.push(`JWT_PRIVATE_KEY_FILE (${env.JWT_PRIVATE_KEY_FILE}) couldn't be read.`);
    }
  }
  if (jwtPrivateKey) {
    jwtPrivateKey = jwtPrivateKey.replace(/\\n/g, "\n");
    try {
      if (createPrivateKey(jwtPrivateKey).asymmetricKeyType !== "ed25519") {
        problems.push("The signing key must be an Ed25519 key. Generate one with: openssl genpkey -algorithm ed25519");
      }
    } catch {
      problems.push("The signing key isn't a valid PEM private key. Generate one with: openssl genpkey -algorithm ed25519");
    }
  } else if (production) {
    problems.push("JWT_PRIVATE_KEY (or JWT_PRIVATE_KEY_FILE) is required in production. Generate one with: openssl genpkey -algorithm ed25519");
  }

  // ---- STUN / TURN ----
  const stunUrls = env.STUN_URLS !== undefined ? list(env.STUN_URLS) : ["stun:stun.l.google.com:19302"];
  const turnUrls = list(env.TURN_URLS);
  const turnSecret = env.TURN_SECRET || undefined;
  for (const url of stunUrls) if (!/^stuns?:[^\s,]+$/.test(url)) problems.push(`STUN_URLS entry "${url}" should look like stun:host:3478.`);
  for (const url of turnUrls) if (!/^turns?:[^\s,]+$/.test(url)) problems.push(`TURN_URLS entry "${url}" should look like turn:host:3478?transport=udp.`);
  if (turnUrls.length > 0 && !turnSecret) problems.push("TURN_URLS is set but TURN_SECRET isn't. It must match the TURN server's static-auth-secret.");
  if (turnSecret && turnUrls.length === 0) problems.push("TURN_SECRET is set but TURN_URLS is empty.");
  if (turnSecret && turnSecret.length < 16) problems.push("TURN_SECRET is too short. Use at least 16 characters (32 or more is better): openssl rand -hex 32");

  if (production && turnUrls.length === 0) {
    warnings.push("No TURN server is configured. People behind strict firewalls, and some mobile networks, won't be able to join calls.");
  }
  if (production && trustProxy === 0) {
    warnings.push("TRUST_PROXY is 0. If a reverse proxy (Caddy, nginx, a load balancer) is in front of this server, set it to the number of proxies, or every visitor will share one rate limit.");
  }

  if (problems.length > 0) throw new ConfigError(problems);

  return {
    port,
    dataDir: env.DATA_DIR ?? join(cwd, ".data"),
    production,
    origins,
    jwtPrivateKey,
    trustProxy,
    ice: { stunUrls, turnUrls, turnSecret, ttlSeconds },
    warnings,
  };
}
