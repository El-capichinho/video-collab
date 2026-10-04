import { useMemo, useSyncExternalStore } from "react";
import { Whiteboard } from "../../core/board/Whiteboard";

/** One Whiteboard for the app. It outlives the panel, so closing the board loses nothing. */
export function useWhiteboard() {
  const board = useMemo(() => new Whiteboard(), []);
  const snapshot = useSyncExternalStore(board.subscribe, board.getSnapshot);
  return { board, snapshot };
}
