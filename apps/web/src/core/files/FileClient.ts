import type { ApiErrorBody, FileInfo } from "@vc/shared";
import { FileApiError, NETWORK_MESSAGE } from "./errors";
import { xhrUpload } from "./xhrUpload";

/** What the shelf needs from the network. FileClient is the real thing; tests use a fake. */
export interface FileTransfer {
  upload(roomId: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<FileInfo>;
  /** An address that downloads the file for the next minute or so. */
  downloadUrl(roomId: string, fileId: string): Promise<string>;
  remove(roomId: string, fileId: string): Promise<void>;
}

export interface FileClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetchFn?: typeof fetch;
}

export class FileClient implements FileTransfer {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly options: FileClientOptions) {
    this.fetchFn = options.fetchFn ?? ((...args) => fetch(...args));
  }

  async upload(roomId: string, file: File, onProgress: (fraction: number) => void, signal: AbortSignal): Promise<FileInfo> {
    const token = await this.options.getToken();
    const reply = await xhrUpload<{ file: FileInfo }>({
      url: `${this.options.baseUrl}/files/${encodeURIComponent(roomId)}`,
      token,
      body: file,
      name: file.name,
      onProgress,
      signal,
    });
    return reply.file;
  }

  async downloadUrl(roomId: string, fileId: string): Promise<string> {
    const response = await this.send("POST", `/files/${encodeURIComponent(roomId)}/${encodeURIComponent(fileId)}/link`);
    const { url } = (await response.json()) as { url: string };
    return this.options.baseUrl + url;
  }

  async remove(roomId: string, fileId: string): Promise<void> {
    await this.send("DELETE", `/files/${encodeURIComponent(roomId)}/${encodeURIComponent(fileId)}`);
  }

  private async send(method: string, path: string): Promise<Response> {
    const token = await this.options.getToken();
    let response: Response;
    try {
      response = await this.fetchFn(this.options.baseUrl + path, { method, headers: { Authorization: `Bearer ${token}` } });
    } catch {
      throw new FileApiError(NETWORK_MESSAGE, "network", 0);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
      throw new FileApiError(body?.error.message ?? "Something went wrong. Try again.", body?.error.code ?? "unknown", response.status);
    }
    return response;
  }
}
