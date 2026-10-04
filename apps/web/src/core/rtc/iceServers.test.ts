import { describe, expect, it, vi } from "vitest";
import { FALLBACK_ICE_SERVERS, fetchIceServers, parseIceServers } from "./iceServers";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const source = (fetchFn: unknown, timeoutMs?: number) => ({
  baseUrl: "http://api",
  getToken: async () => "tok",
  fetchFn: fetchFn as typeof fetch,
  timeoutMs,
});

describe("fetchIceServers", () => {
  it("returns what the server issues, sending the sign-in token", async () => {
    const issued = [
      { urls: ["stun:turn.example.com:3478"] },
      { urls: ["turn:turn.example.com:3478?transport=udp"], username: "1700:u1", credential: "abc=" },
    ];
    const fetchFn = vi.fn(async () => reply({ iceServers: issued, ttlSeconds: 3600 }));

    expect(await fetchIceServers(source(fetchFn))).toEqual(issued);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/rtc/ice");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("falls back to plain STUN rather than blocking the join", async () => {
    expect(await fetchIceServers(source(async () => reply({}, 401)))).toEqual(FALLBACK_ICE_SERVERS);
    expect(await fetchIceServers(source(async () => reply({ iceServers: [] })))).toEqual(FALLBACK_ICE_SERVERS);
    expect(await fetchIceServers(source(async () => new Response("<html>oops</html>", { status: 200 })))).toEqual(FALLBACK_ICE_SERVERS);
    expect(await fetchIceServers(source(async () => { throw new TypeError("Failed to fetch"); }))).toEqual(FALLBACK_ICE_SERVERS);
  });

  it("falls back if the server is too slow", async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError"))));
    expect(await fetchIceServers(source(hang, 20))).toEqual(FALLBACK_ICE_SERVERS);
  });
});

describe("parseIceServers", () => {
  it("keeps valid entries, including a single url given as a string", () => {
    expect(parseIceServers([{ urls: "stun:a:3478" }, { urls: ["turns:b:5349?transport=tcp"], username: "u", credential: "c" }])).toEqual([
      { urls: ["stun:a:3478"] },
      { urls: ["turns:b:5349?transport=tcp"], username: "u", credential: "c" },
    ]);
  });

  it("drops anything malformed, or not an ICE address", () => {
    const messy = [null, 7, "stun:a", {}, { urls: [] }, { urls: ["http://evil.example"] }, { urls: ["stun:ok:3478", 5] }, { urls: ["stun:good:3478"], username: 5 }];
    expect(parseIceServers(messy)).toEqual([{ urls: ["stun:good:3478"] }]);
    expect(parseIceServers("nope")).toEqual([]);
    expect(parseIceServers(undefined)).toEqual([]);
  });
});
