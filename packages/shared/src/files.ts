/**
 * File-sharing rules. Shared so the browser can reject a bad file before uploading
 * it, and the server applies exactly the same checks when it arrives.
 */

export interface FileLimits {
  maxFileBytes: number;
  maxFilesPerRoom: number;
  maxRoomBytes: number;
  maxNameLength: number;
}

export const FILE_LIMITS: FileLimits = {
  maxFileBytes: 25 * 1024 * 1024,
  maxFilesPerRoom: 30,
  maxRoomBytes: 200 * 1024 * 1024,
  maxNameLength: 120,
};

/** What everyone in the room sees about a shared file. */
export interface FileInfo {
  id: string;
  name: string;
  size: number;
  uploaderId: string;
  uploaderName: string;
  /** Epoch milliseconds. */
  uploadedAt: number;
}

/** Programs and scripts: the kinds of file that do harm when opened by mistake. */
const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "scr", "msi", "ps1", "vbs", "vbe", "js", "jse", "jar",
  "apk", "sh", "dll", "lnk", "reg", "hta", "cpl", "msc", "wsf",
]);

/**
 * Makes a file name safe to store, show, and put in a download header: no folders,
 * no control or look-alike characters, no leading dots, and a bounded length that
 * keeps the extension.
 */
export function sanitizeFileName(raw: string, maxLength = FILE_LIMITS.maxNameLength): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  let name = base
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "") // control characters and ones Windows forbids
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "") // hidden text-direction tricks ("gpj.exe" shown as "exe.jpg")
    .trim()
    .replace(/^\.+/, "") // no ".." and no hidden files
    .replace(/[. ]+$/, ""); // Windows drops trailing dots and spaces
  if (name.length > maxLength) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : "";
    name = name.slice(0, maxLength - ext.length) + ext;
  }
  return name;
}

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function isBlockedFileName(name: string): boolean {
  return BLOCKED_EXTENSIONS.has(fileExtension(name));
}

export interface UploadProblem {
  code: "bad_name" | "empty" | "too_large" | "blocked_type";
  message: string;
}

/** Null if the file may be shared; otherwise why not. `name` should already be sanitized. */
export function validateUpload(name: string, size: number, limits: FileLimits = FILE_LIMITS): UploadProblem | null {
  if (name === "") return { code: "bad_name", message: "That file name isn't valid." };
  if (size <= 0) return { code: "empty", message: "That file is empty." };
  if (size > limits.maxFileBytes) {
    const mb = Math.max(1, Math.round(limits.maxFileBytes / (1024 * 1024)));
    return { code: "too_large", message: `Files can be up to ${mb} MB.` };
  }
  if (isBlockedFileName(name)) return { code: "blocked_type", message: "This type of file can't be shared." };
  return null;
}
