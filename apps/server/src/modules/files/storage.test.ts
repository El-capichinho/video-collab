import { randomUUID } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DiskFileStorage, PayloadTooLargeError } from "./storage";

let dir = "";
let storage: DiskFileStorage;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vc-storage-"));
  storage = new DiskFileStorage(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const bytes = (text: string) => Readable.from([Buffer.from(text)]);
const drain = async (stream: Readable) => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString();
};

describe("DiskFileStorage", () => {
  it("stores and reads back exactly what was written", async () => {
    const id = randomUUID();
    expect(await storage.write(id, bytes("hello world"), 100)).toBe(11);
    expect(await drain(storage.read(id))).toBe("hello world");
  });

  it("refuses more than the limit, and leaves nothing behind", async () => {
    const id = randomUUID();
    await expect(storage.write(id, bytes("x".repeat(50)), 10)).rejects.toBeInstanceOf(PayloadTooLargeError);
    expect(await readdir(dir)).toEqual([]);
  });

  it("leaves nothing behind if the upload is cut off part-way", async () => {
    const id = randomUUID();
    const source = new PassThrough();
    const pending = storage.write(id, source, 1000);
    source.write("partial");
    source.destroy(new Error("connection dropped"));
    await expect(pending).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
  });

  it("only shows a file under its real name once it is complete", async () => {
    const id = randomUUID();
    const source = new PassThrough();
    const pending = storage.write(id, source, 1000);
    source.write("part one");
    await new Promise((r) => setTimeout(r, 30));
    expect(await readdir(dir)).toEqual([`${id}.part`]);
    source.end(" and two");
    await pending;
    expect(await readdir(dir)).toEqual([id]);
    expect(await readFile(join(dir, id), "utf8")).toBe("part one and two");
  });

  it("removes files, and removing a missing one is harmless", async () => {
    const id = randomUUID();
    await storage.write(id, bytes("data"), 100);
    await storage.remove(id);
    await storage.remove(id);
    expect(await readdir(dir)).toEqual([]);
  });

  it("refuses ids that aren't ours, so a name can never become a path", async () => {
    for (const bad of ["../secret", "..\\secret", "a/b", "not-a-uuid", ""]) {
      await expect(storage.write(bad, bytes("x"), 10)).rejects.toThrow("Invalid file id");
      expect(() => storage.read(bad)).toThrow("Invalid file id");
    }
  });

  it("clears everything", async () => {
    await storage.write(randomUUID(), bytes("a"), 10);
    await storage.write(randomUUID(), bytes("b"), 10);
    await storage.clear();
    expect(await readdir(dir)).toEqual([]);
  });
});
