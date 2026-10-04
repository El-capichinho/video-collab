import { describe, expect, it, vi } from "vitest";
import { FileClient } from "./FileClient";

const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function setup(response: Response | Error) {
  const fetchFn = vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  const client = new FileClient({
    baseUrl: "http://api",
    getToken: async () => "tok",
    fetchFn: fetchFn as unknown as typeof fetch,
  });
  return { client, fetchFn };
}

describe("FileClient", () => {
  it("asks for a download link and makes it absolute", async () => {
    const { client, fetchFn } = setup(reply({ url: "/files/download/abc.def" }));
    expect(await client.downloadUrl("room-1", "file-1")).toBe("http://api/files/download/abc.def");

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/files/room-1/file-1/link");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("removes a file", async () => {
    const { client, fetchFn } = setup(new Response(null, { status: 204 }));
    await client.remove("room-1", "file-1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api/files/room-1/file-1");
    expect(init.method).toBe("DELETE");
  });

  it("shows the server's explanation when something is refused", async () => {
    const { client } = setup(reply({ error: { code: "not_yours", message: "Only the person who shared a file can remove it." } }, 403));
    await expect(client.remove("room-1", "file-1")).rejects.toMatchObject({
      message: "Only the person who shared a file can remove it.",
      code: "not_yours",
      status: 403,
    });
  });

  it("reports an unreachable server plainly", async () => {
    const { client } = setup(new TypeError("Failed to fetch"));
    await expect(client.downloadUrl("room-1", "file-1")).rejects.toMatchObject({ code: "network" });
  });

  it("escapes anything unusual in the path", async () => {
    const { client, fetchFn } = setup(reply({ url: "/files/download/x" }));
    await client.downloadUrl("room", "a/b?c");
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("http://api/files/room/a%2Fb%3Fc/link");
  });
});
