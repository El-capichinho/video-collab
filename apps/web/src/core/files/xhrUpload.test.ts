import { describe, expect, it } from "vitest";
import { FileApiError } from "./errors";
import { xhrUpload } from "./xhrUpload";

class FakeXhr {
  method = "";
  url = "";
  headers: Record<string, string> = {};
  sent: unknown = undefined;
  aborted = false;
  status = 0;
  responseText = "";
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  open(method: string, url: string) { this.method = method; this.url = url; }
  setRequestHeader(name: string, value: string) { this.headers[name] = value; }
  send(body: unknown) { this.sent = body; }
  abort() { this.aborted = true; this.onabort?.(); }
  reply(status: number, body: unknown) { this.status = status; this.responseText = typeof body === "string" ? body : JSON.stringify(body); this.onload?.(); }
}

function start(extra: { signal?: AbortSignal; onProgress?: (f: number) => void } = {}) {
  const xhr = new FakeXhr();
  const body = new Blob(["hello"]);
  const promise = xhrUpload<{ file: { id: string } }>({
    url: "http://api/files/room",
    token: "tok",
    body,
    name: "Résumé (1).pdf",
    createXhr: () => xhr as unknown as XMLHttpRequest,
    ...extra,
  });
  return { xhr, promise, body };
}

describe("xhrUpload", () => {
  it("sends the file with the sign-in token and an encoded name", () => {
    const { xhr, body } = start();
    expect(xhr.method).toBe("PUT");
    expect(xhr.url).toBe("http://api/files/room");
    expect(xhr.headers).toEqual({
      Authorization: "Bearer tok",
      "X-File-Name": encodeURIComponent("Résumé (1).pdf"),
      "Content-Type": "application/octet-stream",
    });
    expect(xhr.sent).toBe(body);
  });

  it("reports progress as a fraction", () => {
    const seen: number[] = [];
    const { xhr } = start({ onProgress: (f) => seen.push(f) });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 25, total: 100 });
    xhr.upload.onprogress?.({ lengthComputable: false, loaded: 50, total: 0 });
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 100, total: 100 });
    expect(seen).toEqual([0.25, 1]);
  });

  it("resolves with the server's reply", async () => {
    const { xhr, promise } = start();
    xhr.reply(201, { file: { id: "f1" } });
    expect(await promise).toEqual({ file: { id: "f1" } });
  });

  it("turns a server refusal into an error carrying the server's message", async () => {
    const { xhr, promise } = start();
    xhr.reply(415, { error: { code: "blocked_type", message: "This type of file can't be shared." } });
    await expect(promise).rejects.toMatchObject({ message: "This type of file can't be shared.", code: "blocked_type", status: 415 });
  });

  it("copes with a reply that isn't JSON", async () => {
    const { xhr, promise } = start();
    xhr.reply(502, "<html>Bad gateway</html>");
    await expect(promise).rejects.toBeInstanceOf(FileApiError);
  });

  it("reports a dropped connection as a network problem", async () => {
    const { xhr, promise } = start();
    xhr.onerror?.();
    await expect(promise).rejects.toMatchObject({ code: "network" });
  });

  it("cancels on request", async () => {
    const controller = new AbortController();
    const { xhr, promise } = start({ signal: controller.signal });
    controller.abort();
    expect(xhr.aborted).toBe(true);
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("doesn't even start if already cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    const { xhr, promise } = start({ signal: controller.signal });
    expect(xhr.sent).toBeUndefined();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });
});
