import { useMemo, useSyncExternalStore } from "react";
import { FileClient } from "../../core/files/FileClient";
import { FileShelf, startBrowserDownload } from "../../core/files/FileShelf";
import { SERVER_URL } from "../../core/config";
import { authClient } from "../auth/authClient";

/** One FileShelf for the app, so closing the panel loses nothing. */
export function useFileShelf(getToken: () => Promise<string>) {
  const shelf = useMemo(
    () =>
      new FileShelf({
        transfer: new FileClient({ baseUrl: SERVER_URL, getToken }),
        getUserId: () => authClient.currentUser?.id ?? null,
        startDownload: startBrowserDownload,
      }),
    [getToken],
  );
  const snapshot = useSyncExternalStore(shelf.subscribe, shelf.getSnapshot);
  return { shelf, snapshot };
}
