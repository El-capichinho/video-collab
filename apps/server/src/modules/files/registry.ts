import type { FileInfo } from "@vc/shared";

/** The list of files in each room. Empty rooms are forgotten. */
export class FileRegistry {
  private readonly rooms = new Map<string, FileInfo[]>();

  list(roomId: string): FileInfo[] {
    return [...(this.rooms.get(roomId) ?? [])];
  }

  get(roomId: string, fileId: string): FileInfo | undefined {
    return this.rooms.get(roomId)?.find((f) => f.id === fileId);
  }

  add(roomId: string, file: FileInfo): void {
    this.rooms.set(roomId, [...(this.rooms.get(roomId) ?? []), file]);
  }

  remove(roomId: string, fileId: string): FileInfo | undefined {
    const files = this.rooms.get(roomId);
    const file = files?.find((f) => f.id === fileId);
    if (!files || !file) return undefined;
    const rest = files.filter((f) => f.id !== fileId);
    if (rest.length === 0) this.rooms.delete(roomId);
    else this.rooms.set(roomId, rest);
    return file;
  }

  removeRoom(roomId: string): FileInfo[] {
    const files = this.rooms.get(roomId) ?? [];
    this.rooms.delete(roomId);
    return files;
  }

  usage(roomId: string): { count: number; bytes: number } {
    const files = this.rooms.get(roomId) ?? [];
    return { count: files.length, bytes: files.reduce((sum, f) => sum + f.size, 0) };
  }
}
