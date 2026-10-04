import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

export class PayloadTooLargeError extends Error {
  constructor() {
    super("Payload too large");
  }
}

/** Where file bytes live. The rest of the app doesn't care whether that is a disk or S3. */
export interface FileStorage {
  /** Streams `source` into storage, refusing more than `maxBytes`. Returns the byte count. */
  write(id: string, source: Readable, maxBytes: number): Promise<number>;
  read(id: string): Readable;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}

/** Ids are always our own UUIDs, so a file name can never influence a path. */
const SAFE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

export class DiskFileStorage implements FileStorage {
  constructor(private readonly dir: string) {}

  async write(id: string, source: Readable, maxBytes: number): Promise<number> {
    // pipeline() below reports any failure. This listener only covers the instant before it
    // attaches (we create the folder first), so an upload that dies right then can't crash the server.
    source.on("error", () => {});
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const finalPath = this.pathFor(id);
    const tempPath = `${finalPath}.part`;

    let bytes = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new PayloadTooLargeError());
        else callback(null, chunk);
      },
    });

    try {
      await pipeline(source, limiter, createWriteStream(tempPath, { mode: 0o600 }));
      await rename(tempPath, finalPath); // a file only appears under its real name once it is complete
      return bytes;
    } catch (error) {
      await rm(tempPath, { force: true }); // never leave half an upload behind
      throw error;
    }
  }

  read(id: string): Readable {
    return createReadStream(this.pathFor(id));
  }

  async remove(id: string): Promise<void> {
    await rm(this.pathFor(id), { force: true });
  }

  async clear(): Promise<void> {
    await rm(this.dir, { recursive: true, force: true });
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  private pathFor(id: string): string {
    if (!SAFE_ID.test(id)) throw new Error("Invalid file id");
    return join(this.dir, id);
  }
}
