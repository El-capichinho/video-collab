import { randomUUID } from "node:crypto";
import type { Readable } from "node:stream";
import { sanitizeFileName, validateUpload, type FileInfo, type FileLimits } from "@vc/shared";
import type { RoomDirectory } from "../rooms/directory";
import type { DownloadLinks } from "./downloadLinks";
import type { FileRegistry } from "./registry";
import { PayloadTooLargeError, type FileStorage } from "./storage";

export class FileError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Tells the room about changes. Wired to Socket.io in the composition root. */
export interface FileNotifier {
  added(roomId: string, file: FileInfo): void;
  removed(roomId: string, fileId: string): void;
}

export interface FileServiceDeps {
  registry: FileRegistry;
  storage: FileStorage;
  directory: RoomDirectory;
  links: DownloadLinks;
  notifier: FileNotifier;
  limits: FileLimits;
}

export interface Actor {
  id: string;
  displayName: string;
}

const STATUS_FOR_PROBLEM = { bad_name: 400, empty: 400, too_large: 413, blocked_type: 415 } as const;

export class FileService {
  /** Uploads that have been accepted but not finished, so simultaneous uploads can't overshoot a limit. */
  private readonly inflight = new Map<string, { count: number; bytes: number }>();

  constructor(private readonly deps: FileServiceDeps) {}

  list(roomId: string): FileInfo[] {
    return this.deps.registry.list(roomId);
  }

  async upload(user: Actor, roomId: string, rawName: string, declaredBytes: number, body: Readable): Promise<FileInfo> {
    const { registry, storage, directory, notifier, limits } = this.deps;
    this.requireMember(roomId, user.id);

    const name = sanitizeFileName(rawName, limits.maxNameLength);
    const problem = validateUpload(name, declaredBytes, limits);
    if (problem) throw new FileError(STATUS_FOR_PROBLEM[problem.code], problem.code, problem.message);

    const used = registry.usage(roomId);
    const pending = this.inflight.get(roomId) ?? { count: 0, bytes: 0 };
    if (used.count + pending.count >= limits.maxFilesPerRoom) {
      throw new FileError(409, "room_files_full", "This room has reached its limit on shared files.");
    }
    if (used.bytes + pending.bytes + declaredBytes > limits.maxRoomBytes) {
      throw new FileError(413, "room_storage_full", "This room has run out of space for shared files.");
    }

    this.inflight.set(roomId, { count: pending.count + 1, bytes: pending.bytes + declaredBytes });
    const id = randomUUID();
    try {
      const size = await storage.write(id, body, Math.min(declaredBytes, limits.maxFileBytes));

      // The uploader may have left, or the room emptied, while the bytes were arriving.
      if (!directory.isUserInRoom(roomId, user.id)) {
        await storage.remove(id);
        throw new FileError(409, "left_room", "You left the room before the upload finished.");
      }

      const file: FileInfo = { id, name, size, uploaderId: user.id, uploaderName: user.displayName, uploadedAt: Date.now() };
      registry.add(roomId, file);
      notifier.added(roomId, file);
      return file;
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        throw new FileError(413, "too_large", "The file is larger than it said it was.");
      }
      throw error;
    } finally {
      const now = this.inflight.get(roomId);
      if (now && now.count <= 1) this.inflight.delete(roomId);
      else if (now) this.inflight.set(roomId, { count: now.count - 1, bytes: now.bytes - declaredBytes });
    }
  }

  /** A one-minute download link for this person and this file. */
  createLink(user: Actor, roomId: string, fileId: string): string {
    this.requireMember(roomId, user.id);
    if (!this.deps.registry.get(roomId, fileId)) throw new FileError(404, "not_found", "That file is no longer available.");
    return this.deps.links.create({ fileId, roomId, userId: user.id });
  }

  /** Validates a link and opens the file. Access is re-checked now, so leaving the room ends it. */
  open(token: string): { file: FileInfo; stream: Readable } {
    const claims = this.deps.links.verify(token);
    if (!claims) throw new FileError(403, "bad_link", "This download link has expired. Try again.");
    this.requireMember(claims.roomId, claims.userId);
    const file = this.deps.registry.get(claims.roomId, claims.fileId);
    if (!file) throw new FileError(404, "not_found", "That file is no longer available.");
    return { file, stream: this.deps.storage.read(file.id) };
  }

  async remove(user: Actor, roomId: string, fileId: string): Promise<void> {
    this.requireMember(roomId, user.id);
    const file = this.deps.registry.get(roomId, fileId);
    if (!file) throw new FileError(404, "not_found", "That file is no longer available.");
    if (file.uploaderId !== user.id) throw new FileError(403, "not_yours", "Only the person who shared a file can remove it.");
    this.deps.registry.remove(roomId, fileId);
    await this.deps.storage.remove(file.id);
    this.deps.notifier.removed(roomId, fileId);
  }

  /** Called when the last person leaves: the room's files go with it. */
  async dropRoom(roomId: string): Promise<void> {
    const files = this.deps.registry.removeRoom(roomId);
    await Promise.all(files.map((f) => this.deps.storage.remove(f.id)));
  }

  private requireMember(roomId: string, userId: string): void {
    if (!this.deps.directory.isUserInRoom(roomId, userId)) {
      throw new FileError(403, "not_in_room", "Join the room to share or download files.");
    }
  }
}
