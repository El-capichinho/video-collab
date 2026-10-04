import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config";

const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const rsaPem = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const production = {
  NODE_ENV: "production",
  CLIENT_ORIGIN: "https://meet.example.com",
  JWT_PRIVATE_KEY: pem,
  TURN_URLS: "turn:turn.example.com:3478?transport=udp",
  TURN_SECRET: "x".repeat(32),
  TRUST_PROXY: "1",
};

const problemsFor = (env: NodeJS.ProcessEnv, read?: (p: string) => string) => {
  try {
    loadConfig(env, read);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
};

describe("loadConfig: development", () => {
  it("works with nothing set", () => {
    const config = loadConfig({}, undefined, "/work");
    expect(config).toMatchObject({
      port: 4000,
      production: false,
      trustProxy: 0,
      dataDir: "/work/.data",
      origins: ["http://localhost:5173", "http://127.0.0.1:5173"],
    });
    expect(config.ice.stunUrls).toEqual(["stun:stun.l.google.com:19302"]);
    expect(config.ice.turnUrls).toEqual([]);
    expect(config.warnings).toEqual([]);
  });

  it("reads overrides", () => {
    const config = loadConfig({ PORT: "8080", DATA_DIR: "/data", CLIENT_ORIGIN: "http://localhost:3000, http://localhost:3001" });
    expect(config).toMatchObject({ port: 8080, dataDir: "/data", origins: ["http://localhost:3000", "http://localhost:3001"] });
  });
});

describe("loadConfig: production", () => {
  it("accepts a complete configuration without warnings", () => {
    const config = loadConfig(production);
    expect(config.production).toBe(true);
    expect(config.warnings).toEqual([]);
    expect(config.ice.turnUrls).toHaveLength(1);
    expect(config.trustProxy).toBe(1);
  });

  it("reports everything that's missing at once", () => {
    const problems = problemsFor({ NODE_ENV: "production" });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/CLIENT_ORIGIN/);
    expect(problems.join("\n")).toMatch(/JWT_PRIVATE_KEY/);
  });

  it("insists on https, because browsers won't allow the camera otherwise", () => {
    expect(problemsFor({ ...production, CLIENT_ORIGIN: "http://meet.example.com" }).join()).toMatch(/https/);
  });

  it("warns, but still starts, without TURN or a proxy setting", () => {
    const config = loadConfig({ ...production, TURN_URLS: "", TURN_SECRET: "", TRUST_PROXY: undefined });
    expect(config.warnings).toHaveLength(2);
    expect(config.warnings.join(" ")).toMatch(/TURN/);
    expect(config.warnings.join(" ")).toMatch(/TRUST_PROXY/);
  });
});

describe("loadConfig: origins", () => {
  it("rejects the mistakes that silently break CORS", () => {
    for (const bad of ["meet.example.com", "https://meet.example.com/", "https://meet.example.com/app"]) {
      expect(problemsFor({ CLIENT_ORIGIN: bad }).join(), bad).toMatch(/just an origin/);
    }
  });
});

describe("loadConfig: signing key", () => {
  it("turns \\n written on one line back into a multi-line key", () => {
    expect(loadConfig({ JWT_PRIVATE_KEY: pem.replace(/\n/g, "\\n") }).jwtPrivateKey).toBe(pem);
  });

  it("can read the key from a file", () => {
    const config = loadConfig({ JWT_PRIVATE_KEY_FILE: "/run/secrets/jwt" }, (path) => (path === "/run/secrets/jwt" ? pem : ""));
    expect(config.jwtPrivateKey).toBe(pem);
  });

  it("explains an unreadable file, a bad key, the wrong kind of key, and giving both", () => {
    expect(problemsFor({ JWT_PRIVATE_KEY_FILE: "/nope" }, () => { throw new Error("ENOENT"); }).join()).toMatch(/couldn't be read/);
    expect(problemsFor({ JWT_PRIVATE_KEY: "not a key" }).join()).toMatch(/valid PEM/);
    expect(problemsFor({ JWT_PRIVATE_KEY: rsaPem }).join()).toMatch(/Ed25519/);
    expect(problemsFor({ JWT_PRIVATE_KEY: pem, JWT_PRIVATE_KEY_FILE: "/x" }).join()).toMatch(/not both/);
  });
});

describe("loadConfig: TURN", () => {
  it("keeps the URL list and TTL", () => {
    const config = loadConfig({
      TURN_URLS: "turn:a.example.com:3478?transport=udp, turns:a.example.com:5349?transport=tcp",
      TURN_SECRET: "s".repeat(24),
      TURN_TTL_SECONDS: "7200",
    });
    expect(config.ice.turnUrls).toHaveLength(2);
    expect(config.ice.ttlSeconds).toBe(7200);
  });

  it("requires the URLs and the secret together, and a long enough secret", () => {
    expect(problemsFor({ TURN_URLS: "turn:a.example.com:3478" }).join()).toMatch(/TURN_SECRET isn't/);
    expect(problemsFor({ TURN_SECRET: "s".repeat(32) }).join()).toMatch(/TURN_URLS is empty/);
    expect(problemsFor({ TURN_URLS: "turn:a.example.com:3478", TURN_SECRET: "short" }).join()).toMatch(/too short/);
  });

  it("catches URLs that aren't STUN or TURN addresses", () => {
    expect(problemsFor({ TURN_URLS: "https://a.example.com", TURN_SECRET: "s".repeat(32) }).join()).toMatch(/TURN_URLS entry/);
    expect(problemsFor({ STUN_URLS: "turn:a.example.com" }).join()).toMatch(/STUN_URLS entry/);
  });

  it("lets STUN be turned off", () => {
    expect(loadConfig({ STUN_URLS: "" }).ice.stunUrls).toEqual([]);
  });
});

describe("loadConfig: numbers", () => {
  it("rejects values that aren't sensible", () => {
    for (const env of [{ PORT: "0" }, { PORT: "abc" }, { TRUST_PROXY: "-1" }, { TURN_TTL_SECONDS: "5" }]) {
      expect(problemsFor(env).length, JSON.stringify(env)).toBe(1);
    }
  });
});
