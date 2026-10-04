import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TokenService } from "./modules/auth/tokens";
import { startTestServer, TEST_ICE, TEST_ORIGIN } from "./testing/startTestServer";

type TestServer = Awaited<ReturnType<typeof startTestServer>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();

describe("GET /rtc/ice", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(() => srv.close());

  const get = (token?: string) =>
    fetch(`${srv.url}/rtc/ice`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

  it("needs a valid sign-in", async () => {
    expect((await get()).status).toBe(401);
    const forged = (await TokenService.generate().signAccess({ id: "u1", displayName: "Mallory" })).token;
    expect((await get(forged)).status).toBe(401);
  });

  it("returns STUN plus TURN credentials made for that person", async () => {
    const { token } = await srv.tokens.signAccess({ id: "user-7", displayName: "Ama" });
    const res = await get(token);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = await json(res);
    expect(body.ttlSeconds).toBe(TEST_ICE.ttlSeconds);
    const [stun, turn] = body.iceServers;
    expect(stun).toEqual({ urls: TEST_ICE.stunUrls });
    expect(turn.urls).toEqual(TEST_ICE.turnUrls);
    expect(turn.username).toMatch(/^\d+:user-7$/);
    expect(turn.credential).toBe(createHmac("sha1", TEST_ICE.turnSecret).update(turn.username).digest("base64"));
  });

  it("never sends the shared secret", async () => {
    const { token } = await srv.tokens.signAccess({ id: "u", displayName: "Ama" });
    expect(await (await get(token)).text()).not.toContain(TEST_ICE.turnSecret);
  });
});

describe("running behind a reverse proxy", () => {
  const login = (srv: TestServer, forwardedFor: string) =>
    fetch(`${srv.url}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: TEST_ORIGIN, "X-Forwarded-For": forwardedFor },
      body: JSON.stringify({ email: "nobody@example.com", password: "whatever-it-is" }),
    });

  it("when told to trust one proxy, limits each visitor separately", async () => {
    const srv = await startTestServer({ trustProxy: 1, authRateLimit: { windowMs: 60_000, max: 2 } });
    expect((await login(srv, "203.0.113.1")).status).toBe(401);
    expect((await login(srv, "203.0.113.1")).status).toBe(401);
    expect((await login(srv, "203.0.113.1")).status).toBe(429); // this visitor is over the limit...
    expect((await login(srv, "203.0.113.2")).status).toBe(401); // ...but a different one isn't
    srv.close();
  });

  it("when not behind a proxy, ignores a forged forwarding header, so the limit can't be dodged", async () => {
    const srv = await startTestServer({ authRateLimit: { windowMs: 60_000, max: 2 } });
    expect((await login(srv, "203.0.113.1")).status).toBe(401);
    expect((await login(srv, "203.0.113.2")).status).toBe(401);
    expect((await login(srv, "203.0.113.3")).status).toBe(429); // new "address" each time, still limited
    srv.close();
  });
});
