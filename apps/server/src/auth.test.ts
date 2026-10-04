import { io as connect } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenService } from "./modules/auth/tokens";
import { startTestServer, TEST_ORIGIN } from "./testing/startTestServer";

type TestServer = Awaited<ReturnType<typeof startTestServer>>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

const PASSWORD = "correct horse battery";
let counter = 0;
const newEmail = () => `user${++counter}@example.com`;

function api(server: TestServer) {
  const post = (path: string, body?: unknown, cookie?: string, headers: Record<string, string> = {}) =>
    fetch(server.url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: TEST_ORIGIN,
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  const cookieOf = (res: Response) =>
    res.headers.getSetCookie().find((c) => c.startsWith("vc_refresh="))?.split(";")[0];

  const register = async (email = newEmail()) => {
    const res = await post("/auth/register", { email, password: PASSWORD, displayName: "Ama" });
    return { res, email, cookie: cookieOf(res), body: await json(res) };
  };

  return { post, cookieOf, register };
}

describe("registration and login", () => {
  let server: TestServer;
  let http: ReturnType<typeof api>;
  beforeAll(async () => {
    server = await startTestServer();
    http = api(server);
  });
  afterAll(() => server.close());

  it("creates an account, returns a token, and sets a locked-down refresh cookie", async () => {
    const { res, body } = await http.register();
    expect(res.status).toBe(201);
    expect(body.user.displayName).toBe("Ama");
    expect(JSON.stringify(body)).not.toMatch(/password|hash/i);
    expect((await server.tokens.verifyAccess(body.accessToken)).displayName).toBe("Ama");

    const raw = res.headers.getSetCookie().find((c) => c.startsWith("vc_refresh="))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    expect(raw).toMatch(/Path=\/auth/i);
  });

  it("stores only an Argon2id hash of the password", async () => {
    const { email } = await http.register();
    const stored = await server.store.findByEmail(email);
    expect(stored?.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(stored?.passwordHash).not.toContain(PASSWORD);
  });

  it("rejects duplicate emails and weak passwords", async () => {
    const { email } = await http.register();
    const dup = await http.post("/auth/register", { email, password: PASSWORD, displayName: "Ama" });
    expect(dup.status).toBe(409);

    const weak = await http.post("/auth/register", { email: newEmail(), password: "short", displayName: "Ama" });
    expect(weak.status).toBe(400);
    expect((await json(weak)).error.message).toMatch(/at least 10/);
  });

  it("logs in, and gives the same answer for a wrong password and an unknown email", async () => {
    const { email } = await http.register();
    const ok = await http.post("/auth/login", { email, password: PASSWORD });
    expect(ok.status).toBe(200);

    const wrong = await http.post("/auth/login", { email, password: "not the password" });
    const unknown = await http.post("/auth/login", { email: newEmail(), password: PASSWORD });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(await json(wrong)).toEqual(await json(unknown));
  });

  it("protects /auth/me with a valid bearer token", async () => {
    const { body } = await http.register();
    const me = (token?: string) =>
      fetch(`${server.url}/auth/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

    expect((await me(body.accessToken)).status).toBe(200);
    expect((await me()).status).toBe(401);
    expect((await me("not.a.token")).status).toBe(401);
  });

  it("refuses requests from unknown origins", async () => {
    const res = await http.post("/auth/login", { email: newEmail(), password: PASSWORD }, undefined, {
      Origin: "http://evil.example",
    });
    expect(res.status).toBe(403);
  });

  it("logout ends the session", async () => {
    const { cookie } = await http.register();
    expect((await http.post("/auth/logout", undefined, cookie)).status).toBe(204);
    expect((await http.post("/auth/refresh", undefined, cookie)).status).toBe(401);
  });
});

describe("refresh token rotation", () => {
  it("rotates on every refresh, and treats reuse of an old token as theft", async () => {
    const server = await startTestServer({ refreshGraceMs: 0 });
    const http = api(server);
    const { cookie: first } = await http.register();

    const rotated = await http.post("/auth/refresh", undefined, first);
    expect(rotated.status).toBe(200);
    const second = http.cookieOf(rotated);
    expect(second).toBeTruthy();
    expect(second).not.toBe(first);

    const replay = await http.post("/auth/refresh", undefined, first);
    expect(replay.status).toBe(401);
    expect((await json(replay)).error.code).toBe("session_revoked");

    // The legitimate newer token is cut off too: the whole family is revoked.
    expect((await http.post("/auth/refresh", undefined, second)).status).toBe(401);
    server.close();
  });

  it("forgives a near-simultaneous refresh (two tabs) without ending the session", async () => {
    const server = await startTestServer({ refreshGraceMs: 60_000 });
    const http = api(server);
    const { cookie: first } = await http.register();

    const winner = await http.post("/auth/refresh", undefined, first);
    const second = http.cookieOf(winner);
    const loser = await http.post("/auth/refresh", undefined, first);
    expect(loser.status).toBe(401);
    expect((await json(loser)).error.code).toBe("refresh_in_progress");

    expect((await http.post("/auth/refresh", undefined, second)).status).toBe(200);
    server.close();
  });
});

describe("rate limiting", () => {
  it("slows down repeated login attempts", async () => {
    const server = await startTestServer({ authRateLimit: { windowMs: 60_000, max: 3 } });
    const http = api(server);
    const attempt = () => http.post("/auth/login", { email: newEmail(), password: PASSWORD });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(429);
    server.close();
  });
});

describe("socket authentication", () => {
  let server: TestServer;
  beforeAll(async () => {
    server = await startTestServer();
  });
  afterAll(() => server.close());

  const tryConnect = (auth?: { token: string }) =>
    new Promise<{ ok: boolean; message?: string }>((resolve) => {
      const s = connect(server.url, { transports: ["websocket"], forceNew: true, reconnection: false, auth });
      s.on("connect", () => (s.disconnect(), resolve({ ok: true })));
      s.on("connect_error", (e) => (s.disconnect(), resolve({ ok: false, message: e.message })));
    });

  it("accepts a valid token", async () => {
    const { token } = await server.tokens.signAccess({ id: "u1", displayName: "Ama" });
    expect(await tryConnect({ token })).toEqual({ ok: true });
  });

  it("rejects a missing token", async () => {
    expect(await tryConnect()).toEqual({ ok: false, message: "unauthorized" });
  });

  it("rejects a token signed with a different key", async () => {
    const { token } = await TokenService.generate().signAccess({ id: "u1", displayName: "Mallory" });
    expect(await tryConnect({ token })).toEqual({ ok: false, message: "unauthorized" });
  });

  it("rejects an expired token", async () => {
    const { token } = await TokenService.generate({ accessTtlSeconds: -30 }).signAccess({ id: "u1", displayName: "Ama" });
    expect(await tryConnect({ token })).toEqual({ ok: false, message: "unauthorized" });
  });
});
