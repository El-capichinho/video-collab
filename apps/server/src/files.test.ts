import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClientToServerEvents, FileInfo, ServerToClientEvents } from "@vc/shared";
import { TokenService } from "./modules/auth/tokens";
import { startTestServer } from "./testing/startTestServer";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type TestServer = Awaited<ReturnType<typeof startTestServer>>;

const open: Client[] = [];
afterAll(() => open.forEach((c) => c.disconnect()));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const next = (c: Client, event: string): Promise<any> => new Promise((res) => (c as any).once(event, res));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (res: Response): Promise<any> => res.json();
const quiet = (ms = 150) => new Promise((r) => setTimeout(r, ms));
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

class Person {
  socket!: Client;
  constructor(readonly srv: TestServer, readonly name: string, readonly id = randomUUID(), readonly token = "") {}

  static async create(srv: TestServer, name: string): Promise<Person> {
    const id = randomUUID();
    const { token } = await srv.tokens.signAccess({ id, displayName: name });
    const p = new Person(srv, name, id, token);
    p.socket = connect(srv.url, { transports: ["websocket"], forceNew: true, auth: { token } });
    open.push(p.socket);
    await new Promise<void>((resolve, reject) => {
      p.socket.on("connect", () => resolve());
      p.socket.on("connect_error", reject);
    });
    return p;
  }

  async join(roomId: string) {
    const joined = next(this.socket, "room:joined");
    const files = next(this.socket, "files:sync");
    this.socket.emit("room:join", { roomId });
    await joined;
    return (await files).files as FileInfo[];
  }

  upload(roomId: string, name: string, body: string | Buffer, headers: Record<string, string> = {}) {
    return fetch(`${this.srv.url}/files/${roomId}`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.token}`, "X-File-Name": encodeURIComponent(name), "Content-Type": "application/octet-stream", ...headers },
      body,
    });
  }

  link(roomId: string, fileId: string) {
    return fetch(`${this.srv.url}/files/${roomId}/${fileId}/link`, { method: "POST", headers: { Authorization: `Bearer ${this.token}` } });
  }

  remove(roomId: string, fileId: string) {
    return fetch(`${this.srv.url}/files/${roomId}/${fileId}`, { method: "DELETE", headers: { Authorization: `Bearer ${this.token}` } });
  }
}

describe("file sharing", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startTestServer({
      maxRoomSize: 6,
      fileLimits: { maxFileBytes: 1024, maxFilesPerRoom: 3, maxRoomBytes: 2000 },
    });
  });
  afterAll(() => srv.close());

  /** Uploads a file and returns its metadata. */
  async function share(p: Person, room: string, name = "notes.txt", body = "hello") {
    const res = await p.upload(room, name, body);
    expect(res.status).toBe(201);
    return (await json(res)).file as FileInfo;
  }

  it("stores an upload, returns its details, and tells everyone in the room", async () => {
    const [a, b] = [await Person.create(srv, "Ama"), await Person.create(srv, "Kofi")];
    await a.join("files-one");
    await b.join("files-one");

    const bHears = next(b.socket, "file:added");
    const file = await share(a, "files-one", "notes.txt", "hello world");

    expect(file).toMatchObject({ name: "notes.txt", size: 11, uploaderId: a.id, uploaderName: "Ama" });
    expect(file.id).toMatch(UUID);
    expect((await bHears).file).toEqual(file);
    expect(await readdir(srv.uploadDir)).toContain(file.id);
  });

  it("shows people who join later the files already shared", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-two");
    const file = await share(a, "files-two");

    const c = await Person.create(srv, "Esi");
    expect(await c.join("files-two")).toEqual([file]);
  });

  it("needs a valid sign-in", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-three");

    const anonymous = await fetch(`${srv.url}/files/files-three`, { method: "PUT", headers: { "X-File-Name": "a.txt" }, body: "x" });
    expect(anonymous.status).toBe(401);

    const { token } = await TokenService.generate().signAccess({ id: a.id, displayName: "Ama" });
    const forged = await a.upload("files-three", "a.txt", "x", { Authorization: `Bearer ${token}` });
    expect(forged.status).toBe(401);
  });

  it("only lets people who are in the room upload or download", async () => {
    const a = await Person.create(srv, "Ama");
    const outsider = await Person.create(srv, "Mallory");
    const elsewhere = await Person.create(srv, "Esi");
    await a.join("files-four");
    await elsewhere.join("some-other-room");
    const file = await share(a, "files-four");

    for (const p of [outsider, elsewhere]) {
      expect((await p.upload("files-four", "x.txt", "x")).status).toBe(403);
      expect((await p.link("files-four", file.id)).status).toBe(403);
      expect((await p.remove("files-four", file.id)).status).toBe(403);
    }
  });

  it("refuses files that are too big, blocked, empty, or unnamed", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-five");
    const before = await readdir(srv.uploadDir).catch(() => []);

    const tooBig = await a.upload("files-five", "big.bin", Buffer.alloc(2000));
    expect(tooBig.status).toBe(413);
    expect((await json(tooBig)).error.code).toBe("too_large");

    const blocked = await a.upload("files-five", "setup.exe", "MZ");
    expect(blocked.status).toBe(415);
    expect((await json(blocked)).error.message).toMatch(/can't be shared/);

    expect((await a.upload("files-five", "empty.txt", "")).status).toBe(400);
    expect((await a.upload("files-five", "", "data")).status).toBe(400);
    expect((await a.upload("files-five", "..", "data")).status).toBe(400);
    expect(await readdir(srv.uploadDir).catch(() => [])).toEqual(before); // refused uploads leave nothing behind
  });

  it("stores files under random ids, whatever they are called", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-six");
    const file = await share(a, "files-six", "../../etc/passwd", "root:x:0:0");

    expect(file.name).toBe("passwd");
    const onDisk = await readdir(srv.uploadDir);
    expect(onDisk.every((n) => UUID.test(n))).toBe(true);
  });

  it("limits how many files a room can hold", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-seven");
    for (let i = 0; i < 3; i++) await share(a, "files-seven", `f${i}.txt`, "x");

    const fourth = await a.upload("files-seven", "f3.txt", "x");
    expect(fourth.status).toBe(409);
    expect((await json(fourth)).error.code).toBe("room_files_full");
  });

  it("limits how much a room can store", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-eight");
    await share(a, "files-eight", "a.bin", "x".repeat(900));
    await share(a, "files-eight", "b.bin", "x".repeat(900));

    const third = await a.upload("files-eight", "c.bin", "x".repeat(900));
    expect(third.status).toBe(413);
    expect((await json(third)).error.code).toBe("room_storage_full");
  });

  it("downloads through a signed link, as an attachment that can't be run", async () => {
    const a = await Person.create(srv, "Ama");
    const b = await Person.create(srv, "Kofi");
    await a.join("files-nine");
    await b.join("files-nine");
    const file = await share(a, "files-nine", "Résumé.txt", "line one\nline two");

    const { url } = await json(await b.link("files-nine", file.id));
    expect(url).toMatch(/^\/files\/download\//);

    const res = await fetch(srv.url + url); // note: no Authorization header
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("line one\nline two");
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toContain("attachment;");
    expect(res.headers.get("content-disposition")).toContain("R%C3%A9sum%C3%A9.txt");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects a tampered or invented download link", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-ten");
    const file = await share(a, "files-ten");
    const { url } = await json(await a.link("files-ten", file.id));

    expect((await fetch(`${srv.url}${url}x`)).status).toBe(403);
    expect((await fetch(`${srv.url}/files/download/not-a-token`)).status).toBe(403);
  });

  it("stops working for someone who has left the room", async () => {
    const a = await Person.create(srv, "Ama");
    const b = await Person.create(srv, "Kofi");
    await a.join("files-eleven");
    await b.join("files-eleven");
    const file = await share(a, "files-eleven");
    const { url } = await json(await b.link("files-eleven", file.id));

    const gone = next(a.socket, "room:peer-left");
    b.socket.disconnect();
    await gone;
    expect((await fetch(srv.url + url)).status).toBe(403);
  });

  it("lets only the uploader remove a file, and tells the room", async () => {
    const a = await Person.create(srv, "Ama");
    const b = await Person.create(srv, "Kofi");
    await a.join("files-twelve");
    await b.join("files-twelve");
    const file = await share(a, "files-twelve");

    const notYours = await b.remove("files-twelve", file.id);
    expect(notYours.status).toBe(403);
    expect((await json(notYours)).error.code).toBe("not_yours");

    const bHears = next(b.socket, "file:removed");
    expect((await a.remove("files-twelve", file.id)).status).toBe(204);
    expect(await bHears).toEqual({ fileId: file.id });
    expect(await readdir(srv.uploadDir)).not.toContain(file.id);
    expect((await a.remove("files-twelve", file.id)).status).toBe(404);
  });

  it("deletes a room's files when the room empties", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-thirteen");
    const file = await share(a, "files-thirteen");
    expect(await readdir(srv.uploadDir)).toContain(file.id);

    a.socket.disconnect();
    await quiet(300);
    expect(await readdir(srv.uploadDir)).not.toContain(file.id);

    const b = await Person.create(srv, "Kofi");
    expect(await b.join("files-thirteen")).toEqual([]);
  });

  it("rejects a room name that isn't valid", async () => {
    const a = await Person.create(srv, "Ama");
    expect((await a.upload("bad%20room!", "a.txt", "x")).status).toBe(400);
  });

  it("requires the upload to say how big it is", async () => {
    const a = await Person.create(srv, "Ama");
    await a.join("files-fourteen");
    const res = await fetch(`${srv.url}/files/files-fourteen`, {
      method: "PUT",
      headers: { Authorization: `Bearer ${a.token}`, "X-File-Name": "a.txt", "Content-Length": "abc" },
      body: "x",
    }).catch(() => null);
    // Either the client stack refuses to send it, or the server answers 411/400; it must never succeed.
    expect(res === null || res.status >= 400).toBe(true);
  });
});

describe("file sharing: link lifetime and rate limit", () => {
  it("expires download links quickly", async () => {
    const srv = await startTestServer({ maxRoomSize: 6, downloadLinkTtlMs: 80 });
    const a = await Person.create(srv, "Ama");
    await a.join("ttl-room");
    const res = await a.upload("ttl-room", "a.txt", "hello");
    const file = (await json(res)).file as FileInfo;
    const { url } = await json(await a.link("ttl-room", file.id));

    await quiet(200);
    expect((await fetch(srv.url + url)).status).toBe(403);
    srv.close();
  });

  it("slows down someone who uploads too fast", async () => {
    const srv = await startTestServer({ maxRoomSize: 6, fileRateLimit: { windowMs: 60_000, max: 2 } });
    const a = await Person.create(srv, "Ama");
    await a.join("rate-room");
    expect((await a.upload("rate-room", "1.txt", "x")).status).toBe(201);
    expect((await a.upload("rate-room", "2.txt", "x")).status).toBe(201);
    expect((await a.upload("rate-room", "3.txt", "x")).status).toBe(429);
    srv.close();
  });
});
