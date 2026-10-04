import { useEffect, useState } from "react";
import type { BoardTool } from "@vc/shared";
import { EraserIcon, PenIcon, RedoIcon, TrashIcon, UndoIcon } from "../../ui/icons";

export const COLORS = [
  { name: "Black", value: "#1c1c1e" },
  { name: "Red", value: "#ff453a" },
  { name: "Orange", value: "#ff9f0a" },
  { name: "Green", value: "#30d158" },
  { name: "Blue", value: "#0a84ff" },
  { name: "Purple", value: "#bf5af2" },
] as const;

/** Thickness in board units (the board is 1000 wide). */
export const SIZES = [
  { name: "Thin", value: 2.5, dot: 6 },
  { name: "Medium", value: 5, dot: 10 },
  { name: "Thick", value: 10, dot: 16 },
] as const;

interface Props {
  tool: BoardTool;
  color: string;
  size: number;
  canUndo: boolean;
  canRedo: boolean;
  hasContent: boolean;
  onTool: (tool: BoardTool) => void;
  onColor: (color: string) => void;
  onSize: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
}

export function BoardToolbar(p: Props) {
  // Clearing wipes everyone's drawing, so it takes a second tap to confirm.
  const [confirming, setConfirming] = useState(false);
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);
  useEffect(() => {
    if (!p.hasContent) setConfirming(false);
  }, [p.hasContent]);

  return (
    <div className="board-toolbar" role="toolbar" aria-label="Whiteboard tools">
      <div className="tool-group">
        <button className="tool" aria-label="Pen" aria-pressed={p.tool === "pen"} onClick={() => p.onTool("pen")}>
          <PenIcon />
        </button>
        <button className="tool" aria-label="Eraser" aria-pressed={p.tool === "eraser"} onClick={() => p.onTool("eraser")}>
          <EraserIcon />
        </button>
      </div>

      <div className="tool-group" role="group" aria-label="Color">
        {COLORS.map((c) => (
          <button
            key={c.value}
            className="swatch"
            style={{ background: c.value }}
            aria-label={c.name}
            aria-pressed={p.tool === "pen" && p.color === c.value}
            onClick={() => {
              p.onColor(c.value);
              p.onTool("pen");
            }}
          />
        ))}
      </div>

      <div className="tool-group" role="group" aria-label="Thickness">
        {SIZES.map((s) => (
          <button key={s.name} className="tool size" aria-label={s.name} aria-pressed={p.size === s.value} onClick={() => p.onSize(s.value)}>
            <span style={{ width: s.dot, height: s.dot }} />
          </button>
        ))}
      </div>

      <div className="tool-group">
        <button className="tool" aria-label="Undo" disabled={!p.canUndo} onClick={p.onUndo}>
          <UndoIcon />
        </button>
        <button className="tool" aria-label="Redo" disabled={!p.canRedo} onClick={p.onRedo}>
          <RedoIcon />
        </button>
        <button
          className={`tool ${confirming ? "confirm" : ""}`}
          aria-label={confirming ? "Confirm clear for everyone" : "Clear the board"}
          disabled={!p.hasContent}
          onClick={() => {
            if (!confirming) return setConfirming(true);
            setConfirming(false);
            p.onClear();
          }}
        >
          <TrashIcon />
          {confirming && <span className="tool-label">Clear for everyone?</span>}
        </button>
      </div>
    </div>
  );
}
