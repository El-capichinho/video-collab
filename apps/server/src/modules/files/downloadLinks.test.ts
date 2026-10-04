import { describe, expect, it } from "vitest";
import { DownloadLinks } from "./downloadLinks";

const claims = { fileId: "f1", roomId: "room", userId: "u1" };

describe("DownloadLinks", () => {
  it("round-trips the claims", () => {
    const links = new DownloadLinks();
    expect(links.verify(links.create(claims))).toEqual(claims);
  });

  it("expires", () => {
    let now = 1_000;
    const links = new DownloadLinks({ ttlMs: 60_000, now: () => now });
    const token = links.create(claims);
    now += 59_000;
    expect(links.verify(token)).toEqual(claims);
    now += 2_000;
    expect(links.verify(token)).toBeNull();
  });

  it("rejects a token that has been altered", () => {
    const links = new DownloadLinks();
    const [payload, signature] = links.create(claims).split(".") as [string, string];
    const forged = Buffer.from(JSON.stringify({ ...claims, userId: "someone-else", exp: Date.now() + 60_000 })).toString("base64url");
    expect(links.verify(`${forged}.${signature}`)).toBeNull();
    expect(links.verify(`${payload}.${signature.slice(0, -2)}AA`)).toBeNull();
  });

  it("rejects a token signed by a different server", () => {
    const token = new DownloadLinks().create(claims);
    expect(new DownloadLinks().verify(token)).toBeNull();
  });

  it("rejects garbage without throwing", () => {
    const links = new DownloadLinks();
    for (const junk of ["", "abc", "a.b.c", ".", "..", "🙂.🙂"]) expect(links.verify(junk)).toBeNull();
  });
});
