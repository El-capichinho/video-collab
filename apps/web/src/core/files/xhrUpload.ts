import { FileApiError, NETWORK_MESSAGE } from "./errors";

export interface XhrUploadOptions {
  url: string;
  token: string;
  body: Blob;
  name: string;
  /** Fraction sent so far, 0 to 1. */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Injected in tests. */
  createXhr?: () => XMLHttpRequest;
}

/**
 * Uploads a file and reports progress. fetch() can't report upload progress, so this
 * uses XMLHttpRequest. Resolves with the server's JSON reply.
 */
export function xhrUpload<T>(options: XhrUploadOptions): Promise<T> {
  const { url, token, body, name, onProgress, signal } = options;

  return new Promise<T>((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Upload cancelled", "AbortError"));

    const xhr = (options.createXhr ?? (() => new XMLHttpRequest()))();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(name)); // header values can't hold arbitrary characters
    xhr.setRequestHeader("Content-Type", "application/octet-stream");

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) onProgress?.(event.loaded / event.total);
    };
    xhr.onload = () => {
      let data: unknown = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* not JSON: handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(data as T);
      const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
      reject(new FileApiError(error?.message ?? "The upload didn't go through. Try again.", error?.code ?? "unknown", xhr.status));
    };
    // A server that refuses a large file early may drop the connection, which looks like a network error.
    xhr.onerror = () => reject(new FileApiError(NETWORK_MESSAGE, "network", 0));
    xhr.ontimeout = () => reject(new FileApiError(NETWORK_MESSAGE, "network", 0));
    xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));

    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}
