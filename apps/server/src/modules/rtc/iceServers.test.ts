import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { IceServerProvider, type IceConfig } from "./iceServers";

const base: IceConfig = {
  stunUrls: ["stun:turn.example.com:3478"],
  turnUrls: ["turn:turn.example.com:3478?transport=udp", "turn:turn.example.com:3478?transport=tcp"],
  turnSecret: "a-shared-secret-with-coturn-1234",
  ttlSeconds: 3600,
};

describe("IceServerProvider", () => {
  it("issues credentials in the form coturn checks: expiry:user, signed with HMAC-SHA1", () => {
    const provider = new IceServerProvider(base, () => 1_700_000_000_000);
    const turn = provider.issue("user-42").iceServers.find((s) => s.username)!;

    expect(turn.username).toBe(`${1_700_000_000 + 3600}:user-42`);
    const expected = createHmac("sha1", base.turnSecret!).update(turn.username!).digest("base64");
    expect(turn.credential).toBe(expected);
    expect(turn.urls).toEqual(base.turnUrls);
  });

  it("includes STUN with no credentials", () => {
    const { iceServers } = new IceServerProvider(base).issue("u");
    expect(iceServers[0]).toEqual({ urls: base.stunUrls });
  });

  it("gives each person their own credentials, and fresh ones each time time passes", () => {
    let now = 1_000_000;
    const provider = new IceServerProvider(base, () => now);
    const get = (id: string) => provider.issue(id).iceServers.find((s) => s.username)!;

    const a = get("a");
    expect(get("b").credential).not.toBe(a.credential);
    now += 60_000;
    expect(get("a").credential).not.toBe(a.credential);
  });

  it("never reveals the shared secret", () => {
    const reply = JSON.stringify(new IceServerProvider(base).issue("u"));
    expect(reply).not.toContain(base.turnSecret);
  });

  it("offers only STUN when no TURN server is configured", () => {
    const { iceServers } = new IceServerProvider({ ...base, turnUrls: [], turnSecret: undefined }).issue("u");
    expect(iceServers).toEqual([{ urls: base.stunUrls }]);
  });

  it("won't offer TURN without a secret to sign with", () => {
    const { iceServers } = new IceServerProvider({ ...base, turnSecret: undefined }).issue("u");
    expect(iceServers.some((s) => s.username)).toBe(false);
  });

  it("reports how long the credentials last", () => {
    expect(new IceServerProvider(base).issue("u").ttlSeconds).toBe(3600);
  });
});
