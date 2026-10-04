import { useEffect, useRef, useState } from "react";
import { FILE_LIMITS } from "@vc/shared";
import { formatBytes, formatClock } from "../../core/files/format";
import type { FileShelf, ShelfSnapshot } from "../../core/files/FileShelf";
import { CloseIcon, DownloadIcon, FileIcon, TrashIcon } from "../../ui/icons";

interface Props {
  shelf: FileShelf;
  snapshot: ShelfSnapshot;
  /** The signed-in account, so we can offer to remove only our own files. */
  selfId: string | null;
  onClose: () => void;
}

export function FilesPanel({ shelf, snapshot, selfId, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => closeRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // A file dropped anywhere else would make the browser open it and leave the call.
    const ignore = (e: DragEvent) => e.preventDefault();
    window.addEventListener("keydown", onKey);
    window.addEventListener("dragover", ignore);
    window.addEventListener("drop", ignore);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("dragover", ignore);
      window.removeEventListener("drop", ignore);
    };
  }, [onClose]);

  const addFiles = (list: FileList | null) => {
    if (list) Array.from(list).forEach((file) => shelf.upload(file));
  };

  const empty = snapshot.files.length === 0 && snapshot.uploads.length === 0;

  return (
    <aside className="sheet" role="dialog" aria-label="Shared files">
      <header className="sheet-head">
        <h2>Files</h2>
        <button ref={closeRef} className="tool" aria-label="Close files" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>

      <div
        className="dropzone"
        data-dragging={dragging}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
      >
        <p>Drop files here to share them with everyone in the room</p>
        <button className="secondary" onClick={() => inputRef.current?.click()}>
          Choose files
        </button>
        <small>Up to {formatBytes(FILE_LIMITS.maxFileBytes)} each. Programs and scripts can't be shared.</small>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = ""; // so choosing the same file again still counts
          }}
        />
      </div>

      <p className="form-error" role="alert" hidden={!snapshot.error}>
        {snapshot.error}
      </p>

      {empty ? (
        <p className="sheet-empty">Nothing shared yet. Files disappear when everyone leaves the room.</p>
      ) : (
        <ul className="file-list">
          {snapshot.uploads.map((upload) => (
            <li key={upload.id} className="file-row" data-state={upload.status}>
              <span className="file-icon"><FileIcon /></span>
              <div className="file-main">
                <span className="file-name" title={upload.name}>{upload.name}</span>
                {upload.status === "failed" ? (
                  <span className="file-meta file-error">{upload.error}</span>
                ) : (
                  <>
                    <div
                      className="progress"
                      role="progressbar"
                      aria-label={`Uploading ${upload.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(upload.progress * 100)}
                    >
                      <span style={{ width: `${upload.progress * 100}%` }} />
                    </div>
                    <span className="file-meta">
                      {upload.status === "queued" ? "Waiting…" : `${Math.round(upload.progress * 100)}%`}
                    </span>
                  </>
                )}
              </div>
              <button
                className="tool"
                aria-label={`${upload.status === "failed" ? "Dismiss" : "Cancel"} ${upload.name}`}
                onClick={() => shelf.cancelUpload(upload.id)}
              >
                <CloseIcon />
              </button>
            </li>
          ))}

          {[...snapshot.files].reverse().map((file) => (
            <li key={file.id} className="file-row">
              <span className="file-icon"><FileIcon /></span>
              <div className="file-main">
                <span className="file-name" title={file.name}>{file.name}</span>
                <span className="file-meta">
                  {formatBytes(file.size)} · {file.uploaderId === selfId ? "You" : file.uploaderName} · {formatClock(file.uploadedAt)}
                </span>
              </div>
              <button className="tool" aria-label={`Download ${file.name}`} onClick={() => void shelf.download(file)}>
                <DownloadIcon />
              </button>
              {file.uploaderId === selfId && (
                <button className="tool" aria-label={`Remove ${file.name}`} onClick={() => void shelf.remove(file)}>
                  <TrashIcon />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
