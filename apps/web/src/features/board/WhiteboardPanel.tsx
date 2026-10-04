import { useState } from "react";
import type { BoardTool } from "@vc/shared";
import type { BoardSnapshot, Whiteboard } from "../../core/board/Whiteboard";
import { BoardToolbar, COLORS, SIZES } from "./BoardToolbar";
import { WhiteboardCanvas } from "./WhiteboardCanvas";

interface Props {
  board: Whiteboard;
  snapshot: BoardSnapshot;
}

export function WhiteboardPanel({ board, snapshot }: Props) {
  const [tool, setTool] = useState<BoardTool>("pen");
  const [color, setColor] = useState<string>(COLORS[0].value);
  const [size, setSize] = useState<number>(SIZES[1].value);

  return (
    <div className="board-wrap">
      <div className="board">
        <WhiteboardCanvas board={board} style={{ tool, color, width: size }} />
      </div>
      <BoardToolbar
        tool={tool}
        color={color}
        size={size}
        canUndo={snapshot.canUndo}
        canRedo={snapshot.canRedo}
        hasContent={snapshot.hasContent}
        onTool={setTool}
        onColor={setColor}
        onSize={setSize}
        onUndo={() => board.undo()}
        onRedo={() => board.redo()}
        onClear={() => board.clear()}
      />
    </div>
  );
}
