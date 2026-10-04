import { describe, expect, it, vi } from "vitest";
import type { FileInfo } from "@vc/shared";
import { FileApiError } from "./errors";
import type { FileTransfer } from "./FileClient";
import { FileShelf } from "./FileShelf";

const ME = "me";
const info = (id: string, uploaderId = "kofi", name = `${id}.txt`): FileInfo => ({
  id, name, size: 100, uploaderId, uploaderName: uploaderId, uploadedAt: 1,
});
const fakeFile = (name: string, size = 100) => ({ name, size }) as File;
const flush = () => new Promise((r) => setTimeout(r, 0));

/** An upload the test finishes by hand, so the queue's order can be observed. */
function controllableTransfer() {
  const started: string[] = [];
  const pending = new Map<string, { resolve: (f: FileInfo) => void; reject: (e: unknown) => void; progress: (n: number) => void; signal: AbortSignal }>();
  const transfer: FileTransfer = {
    upload: (_room, file, onProgress, signal) =>
      new Promise<FileInfo>((resolve, reject) => {
        started.push(file.name);
        pending.set(file.name, { resolve, reject, progress: onProgress, signal });
        signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")));
      }),
    downloadUrl: vi.fn(async (_room: string, fileId: string) => `http://api/dl/${fileId}`),
    remove: vi.fn(async () => {}),
  };
  return { transfer, started, pending };
}

function setup() {
  const t = controllableTransfer();
  const downloads: string[] = [];
  const shelf = new FileShelf({
    transfer: t.transfer,
    getUserId: () => ME,
    startDownload: (url) => downloads.push(url),
  });
  shelf.attach("room-1");
  return { shelf, downloads, ...t };
}

describe("FileShelf: sharing the list", () => {
  it("starts from the files already in the room", () => {
    const { shelf } = setup();
    shelf.applySync([info("a"), info("b")]);
    expect(shelf.getSnapshot().files.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("adds and removes files as others share and withdraw them", () => {
    const { shelf } = setup();
    shelf.applyAdded(info("a"));
    shelf.applyAdded(info("b"));
    shelf.applyRemoved("a");
    expect(shelf.getSnapshot().files.map((f) => f.id)).toEqual(["b"]);
  });

  it("ignores the same file arriving twice", () => {
    const { shelf } = setup();
    shelf.applyAdded(info("a"));
    shelf.applyAdded(info("a"));
    expect(shelf.getSnapshot().files).toHaveLength(1);
  });

  it("counts files from others as unseen, but not our own", () => {
    const { shelf } = setup();
    shelf.applyAdded(info("theirs", "kofi"));
    shelf.applyAdded(info("mine", ME));
    expect(shelf.getSnapshot().unseen).toBe(1);
    shelf.markSeen();
    expect(shelf.getSnapshot().unseen).toBe(0);
  });

  it("forgets everything when the call ends", () => {
    const { shelf } = setup();
    shelf.applyAdded(info("a"));
    shelf.detach();
    expect(shelf.getSnapshot()).toMatchObject({ roomId: null, files: [], uploads: [], unseen: 0 });
  });
});

describe("FileShelf: uploading", () => {
  it("refuses a bad file straight away, without touching the network", () => {
    const { shelf, started } = setup();
    shelf.upload(fakeFile("setup.exe"));
    shelf.upload(fakeFile("huge.bin", 30 * 1024 * 1024));
    shelf.upload(fakeFile("empty.txt", 0));

    expect(started).toEqual([]);
    expect(shelf.getSnapshot().uploads.map((u) => [u.status, u.error])).toEqual([
      ["failed", "This type of file can't be shared."],
      ["failed", "Files can be up to 25 MB."],
      ["failed", "That file is empty."],
    ]);
  });

  it("shows progress, then moves a finished upload into the file list", async () => {
    const { shelf, pending } = setup();
    shelf.upload(fakeFile("notes.txt"));
    await flush();
    expect(shelf.getSnapshot().uploads[0]).toMatchObject({ status: "uploading", progress: 0 });

    pending.get("notes.txt")!.progress(0.4);
    expect(shelf.getSnapshot().uploads[0]?.progress).toBe(0.4);

    pending.get("notes.txt")!.resolve(info("f1", ME, "notes.txt"));
    await flush();
    expect(shelf.getSnapshot().uploads).toEqual([]);
    expect(shelf.getSnapshot().files.map((f) => f.id)).toEqual(["f1"]);
    expect(shelf.getSnapshot().unseen).toBe(0);
  });

  it("uploads one file at a time, so it doesn't fight the call for bandwidth", async () => {
    const { shelf, started, pending } = setup();
    shelf.upload(fakeFile("one.txt"));
    shelf.upload(fakeFile("two.txt"));
    shelf.upload(fakeFile("three.txt"));
    await flush();
    expect(started).toEqual(["one.txt"]);
    expect(shelf.getSnapshot().uploads.map((u) => u.status)).toEqual(["uploading", "queued", "queued"]);

    pending.get("one.txt")!.resolve(info("f1", ME));
    await flush();
    expect(started).toEqual(["one.txt", "two.txt"]);

    pending.get("two.txt")!.resolve(info("f2", ME));
    await flush();
    pending.get("three.txt")!.resolve(info("f3", ME));
    await flush();
    expect(shelf.getSnapshot().files.map((f) => f.id)).toEqual(["f1", "f2", "f3"]);
  });

  it("keeps a failed upload visible with the reason, and carries on with the next", async () => {
    const { shelf, pending } = setup();
    shelf.upload(fakeFile("a.txt"));
    shelf.upload(fakeFile("b.txt"));
    await flush();

    pending.get("a.txt")!.reject(new FileApiError("This room has run out of space for shared files.", "room_storage_full", 413));
    await flush();
    expect(shelf.getSnapshot().uploads.map((u) => [u.name, u.status])).toEqual([["a.txt", "failed"], ["b.txt", "uploading"]]);
    expect(shelf.getSnapshot().uploads[0]?.error).toMatch(/run out of space/);
  });

  it("explains an unexpected failure in plain words", async () => {
    const { shelf, pending } = setup();
    shelf.upload(fakeFile("a.txt"));
    await flush();
    pending.get("a.txt")!.reject(new Error("boom"));
    await flush();
    expect(shelf.getSnapshot().uploads[0]?.error).toMatch(/Couldn't reach the server/);
  });

  it("cancels an upload under way, and the queue moves on", async () => {
    const { shelf, started, pending } = setup();
    shelf.upload(fakeFile("a.txt"));
    shelf.upload(fakeFile("b.txt"));
    await flush();

    shelf.cancelUpload(shelf.getSnapshot().uploads[0]!.id);
    expect(pending.get("a.txt")!.signal.aborted).toBe(true);
    await flush();
    expect(started).toEqual(["a.txt", "b.txt"]);
    expect(shelf.getSnapshot().uploads.map((u) => u.name)).toEqual(["b.txt"]);
  });

  it("cancels a queued upload before it ever starts", async () => {
    const { shelf, started } = setup();
    shelf.upload(fakeFile("a.txt"));
    shelf.upload(fakeFile("b.txt"));
    await flush();

    shelf.cancelUpload(shelf.getSnapshot().uploads[1]!.id);
    expect(shelf.getSnapshot().uploads.map((u) => u.name)).toEqual(["a.txt"]);
    expect(started).toEqual(["a.txt"]);
  });

  it("dismisses a failed upload", () => {
    const { shelf } = setup();
    shelf.upload(fakeFile("setup.exe"));
    shelf.cancelUpload(shelf.getSnapshot().uploads[0]!.id);
    expect(shelf.getSnapshot().uploads).toEqual([]);
  });

  it("stops everything if the call ends mid-upload, adding nothing afterwards", async () => {
    const { shelf, started, pending } = setup();
    shelf.upload(fakeFile("a.txt"));
    shelf.upload(fakeFile("b.txt"));
    await flush();

    shelf.detach();
    expect(pending.get("a.txt")!.signal.aborted).toBe(true);
    await flush();
    expect(started).toEqual(["a.txt"]); // b never starts
    expect(shelf.getSnapshot().files).toEqual([]);
    expect(shelf.getSnapshot().uploads).toEqual([]);
  });

  it("won't upload when not in a room", () => {
    const { shelf, started } = setup();
    shelf.detach();
    shelf.upload(fakeFile("a.txt"));
    expect(started).toEqual([]);
    expect(shelf.getSnapshot().uploads).toEqual([]);
  });
});

describe("FileShelf: downloading and removing", () => {
  it("asks for a fresh link and hands it to the browser", async () => {
    const { shelf, downloads, transfer } = setup();
    await shelf.download(info("f1"));
    expect(transfer.downloadUrl).toHaveBeenCalledWith("room-1", "f1");
    expect(downloads).toEqual(["http://api/dl/f1"]);
  });

  it("says so if the file is gone", async () => {
    const { shelf, downloads, transfer } = setup();
    vi.mocked(transfer.downloadUrl).mockRejectedValueOnce(new FileApiError("That file is no longer available.", "not_found", 404));
    await shelf.download(info("f1"));
    expect(downloads).toEqual([]);
    expect(shelf.getSnapshot().error).toBe("That file is no longer available.");
  });

  it("removes a file from the list once the server agrees", async () => {
    const { shelf, transfer } = setup();
    shelf.applyAdded(info("f1", ME));
    await shelf.remove(info("f1", ME));
    expect(transfer.remove).toHaveBeenCalledWith("room-1", "f1");
    expect(shelf.getSnapshot().files).toEqual([]);
  });

  it("keeps the file and explains if removal is refused", async () => {
    const { shelf, transfer } = setup();
    shelf.applyAdded(info("f1", "kofi"));
    vi.mocked(transfer.remove).mockRejectedValueOnce(new FileApiError("Only the person who shared a file can remove it.", "not_yours", 403));
    await shelf.remove(info("f1", "kofi"));
    expect(shelf.getSnapshot().files).toHaveLength(1);
    expect(shelf.getSnapshot().error).toMatch(/Only the person who shared/);
  });

  it("clears an old error when the next action starts", () => {
    const { shelf } = setup();
    shelf.upload(fakeFile("a.txt"));
    expect(shelf.getSnapshot().error).toBeNull();
  });
});
