import { sanitizeFileName, validateUpload, type FileInfo } from "@vc/shared";
import { FileApiError, NETWORK_MESSAGE } from "./errors";
import type { FileTransfer } from "./FileClient";

/** What the room forwards to the shelf. FileShelf implements this. */
export interface FilePort {
  attach(roomId: string): void;
  detach(): void;
  applySync(files: FileInfo[]): void;
  applyAdded(file: FileInfo): void;
  applyRemoved(fileId: string): void;
}

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** 0 to 1. */
  progress: number;
  status: "queued" | "uploading" | "failed";
  error: string | null;
}

export interface ShelfSnapshot {
  roomId: string | null;
  files: FileInfo[];
  uploads: UploadItem[];
  /** Files other people shared since the panel was last looked at. */
  unseen: number;
  /** The latest thing that went wrong with a download or removal. */
  error: string | null;
}

export interface FileShelfOptions {
  transfer: FileTransfer;
  /** The signed-in account's id, to tell our own files from other people's. */
  getUserId: () => string | null;
  /** Hands a download address to the browser. */
  startDownload: (url: string) => void;
}

interface QueuedUpload {
  item: UploadItem;
  file: File;
  controller: AbortController;
}

const EMPTY: ShelfSnapshot = { roomId: null, files: [], uploads: [], unseen: 0, error: null };

/** Plain-browser download: an invisible link, which the server's "attachment" header turns into a save. */
export function startBrowserDownload(url: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * The room's shared files as seen from one browser: the list, plus our uploads in
 * progress. Uploads go one at a time, so they don't compete with the call for bandwidth.
 */
export class FileShelf implements FilePort {
  private snapshot: ShelfSnapshot = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly queue: QueuedUpload[] = [];
  private running = false;
  private generation = 0;

  constructor(private readonly options: FileShelfOptions) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): ShelfSnapshot => this.snapshot;

  // ---- connection ----

  attach(roomId: string): void {
    this.set({ roomId });
  }

  detach(): void {
    this.generation++; // anything still running belongs to a room we've left
    for (const job of this.queue) job.controller.abort();
    this.queue.length = 0;
    this.running = false;
    this.snapshot = EMPTY;
    this.emit();
  }

  // ---- what we do ----

  /** Validates the file, then adds it to the upload queue. */
  upload(file: File): void {
    const roomId = this.snapshot.roomId;
    if (!roomId) return;

    const name = sanitizeFileName(file.name);
    const problem = validateUpload(name, file.size);
    const item: UploadItem = {
      id: crypto.randomUUID(),
      name: name || file.name || "file",
      size: file.size,
      progress: 0,
      status: problem ? "failed" : "queued",
      error: problem?.message ?? null,
    };
    this.set({ uploads: [...this.snapshot.uploads, item], error: null });
    if (problem) return;

    this.queue.push({ item, file, controller: new AbortController() });
    void this.drain();
  }

  /** Stops an upload that is waiting or under way, or dismisses a failed one. */
  cancelUpload(id: string): void {
    const index = this.queue.findIndex((job) => job.item.id === id);
    if (index >= 0) {
      this.queue[index]?.controller.abort();
      this.queue.splice(index, 1);
    }
    this.dropUpload(id);
  }

  async download(file: FileInfo): Promise<void> {
    const roomId = this.snapshot.roomId;
    if (!roomId) return;
    try {
      this.options.startDownload(await this.options.transfer.downloadUrl(roomId, file.id));
    } catch (error) {
      this.set({ error: messageFor(error) });
    }
  }

  async remove(file: FileInfo): Promise<void> {
    const roomId = this.snapshot.roomId;
    if (!roomId) return;
    try {
      await this.options.transfer.remove(roomId, file.id);
      this.applyRemoved(file.id);
    } catch (error) {
      this.set({ error: messageFor(error) });
    }
  }

  /** Call while the panel is open. */
  markSeen(): void {
    if (this.snapshot.unseen !== 0) this.set({ unseen: 0 });
  }

  // ---- what the room tells us ----

  applySync(files: FileInfo[]): void {
    this.set({ files: [...files] });
  }

  applyAdded(file: FileInfo): void {
    if (this.snapshot.files.some((f) => f.id === file.id)) return; // we hear about our own upload twice
    const theirs = file.uploaderId !== this.options.getUserId();
    this.set({ files: [...this.snapshot.files, file], unseen: this.snapshot.unseen + (theirs ? 1 : 0) });
  }

  applyRemoved(fileId: string): void {
    if (!this.snapshot.files.some((f) => f.id === fileId)) return;
    this.set({ files: this.snapshot.files.filter((f) => f.id !== fileId) });
  }

  // ---- internals ----

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const generation = this.generation;

    while (this.queue.length > 0 && generation === this.generation) {
      const job = this.queue[0]!;
      const roomId = this.snapshot.roomId;
      if (!roomId) break;
      this.patchUpload(job.item.id, { status: "uploading" });

      try {
        const file = await this.options.transfer.upload(
          roomId,
          job.file,
          (fraction) => this.patchUpload(job.item.id, { progress: fraction }),
          job.controller.signal,
        );
        if (generation !== this.generation) return;
        this.dropUpload(job.item.id);
        this.applyAdded(file);
      } catch (error) {
        if (generation !== this.generation) return;
        if (isAbort(error)) this.dropUpload(job.item.id);
        else this.patchUpload(job.item.id, { status: "failed", error: messageFor(error) });
      }
      // Remove this job by identity: cancelling may already have taken it out of the queue,
      // and removing "the first item" would then discard the next upload instead.
      const position = this.queue.indexOf(job);
      if (position >= 0) this.queue.splice(position, 1);
    }
    if (generation === this.generation) this.running = false;
  }

  private patchUpload(id: string, patch: Partial<UploadItem>): void {
    this.set({ uploads: this.snapshot.uploads.map((u) => (u.id === id ? { ...u, ...patch } : u)) });
  }

  private dropUpload(id: string): void {
    this.set({ uploads: this.snapshot.uploads.filter((u) => u.id !== id) });
  }

  private set(patch: Partial<ShelfSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function messageFor(error: unknown): string {
  return error instanceof FileApiError ? error.message : NETWORK_MESSAGE;
}
