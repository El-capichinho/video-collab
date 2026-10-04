import { describe, expect, it, vi } from "vitest";
import type { AuthResponse } from "@vc/shared";
import { AuthApiError, AuthClient } from "./AuthClient";

const user = { id: "u1", email: "ama@example.com", displayName: "Ama" };
const session = (expiresInMs = 600_000): AuthResponse => ({
  user,
  accessToken: "token-1",
  expiresAt: Date.now() + expiresInMs,
});
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const failure = (code: string, status = 401) => reply({ error: { code, message: code } }, status);

function setup(...responses: Response[]) {
  const queue = [...responses];
  const fetchFn = vi.fn(async () => queue.shift() ?? failure("unexpected"));
  const client = new AuthClient("http://api.test", { fetchFn: fetchFn as unknown as typeof fetch, retryDelayMs: 0 });
  return { client, fetchFn };
}

describe("AuthClient", () => {
  it("keeps the token in memory and tells subscribers who signed in", async () => {
    const { client } = setup(reply(session()));
    const seen: unknown[] = [];
    client.subscribe((u) => seen.push(u));

    await client.login({ email: user.email, password: "correct horse battery" });
    expect(seen).toEqual([user]);
    expect(await client.getAccessToken()).toBe("token-1");
  });

  it("sends the refresh cookie with credentials", async () => {
    const { client, fetchFn } = setup(reply(session()));
    await client.restoreSession();
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.credentials).toBe("include");
  });

  it("shares one refresh between concurrent callers", async () => {
    const { client, fetchFn } = setup(reply(session()));
    const [a, b] = await Promise.all([client.restoreSession(), client.restoreSession()]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
  });

  it("retries once when another tab is mid-rotation", async () => {
    const { client, fetchFn } = setup(failure("refresh_in_progress"), reply(session()));
    expect(await client.restoreSession()).toEqual(user);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("renews a token that is about to expire, and signs out if that fails", async () => {
    const { client } = setup(reply(session(1_000)), failure("session_expired"));
    await client.login({ email: user.email, password: "x" });
    const seen: unknown[] = [];
    client.subscribe((u) => seen.push(u));

    await expect(client.getAccessToken()).rejects.toBeInstanceOf(AuthApiError);
    expect(seen).toEqual([null]);
  });

  it("does not sign the user out because the server is down", async () => {
    const { client } = setup(reply(session(), 200));
    await client.login({ email: user.email, password: "x" });
    const down = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    const offline = new AuthClient("http://api.test", { fetchFn: down as unknown as typeof fetch });
    await expect(offline.restoreSession()).rejects.toBeInstanceOf(TypeError);
    expect(client.currentUser).toEqual(user);
  });
});
