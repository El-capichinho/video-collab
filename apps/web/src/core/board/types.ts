import type { BoardDraw, BoardDrawEvent, Stroke } from "@vc/shared";

/** How the board talks to the server. RoomClient provides this. */
export interface BoardSender {
  sendBoardDraw(draw: BoardDraw): void;
  sendBoardUndo(): void;
  sendBoardRedo(): void;
  sendBoardClear(): void;
}

/** What the room forwards to the board. Whiteboard implements this. */
export interface BoardPort {
  attach(sender: BoardSender, selfId: string): void;
  detach(): void;
  applySync(strokes: Stroke[]): void;
  applyDraw(draw: BoardDrawEvent): void;
  applyAdd(stroke: Stroke): void;
  applyRemove(strokeId: string, by: string): void;
  applyCleared(): void;
}
