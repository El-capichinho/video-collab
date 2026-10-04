import { describe, expect, it } from "vitest";
import type { BoardDraw } from "@vc/shared";
import { Board, DEFAULT_BOARD_LIMITS } from "./board";

const draw = (strokeId: string, points: number[], end = false): BoardDraw => ({
  strokeId,
  tool: "pen",
  color: "#1c1c1e",
  width: 5,
  points,
  end,
});

describe("Board", () => {
  it("builds a stroke from several batches", () => {
    const board = new Board();
    board.draw("a", draw("s1", [0.1, 0.1, 0.2, 0.2]));
    board.draw("a", draw("s1", [0.3, 0.3], true));
    expect(board.snapshot()).toEqual([
      { id: "s1", ownerId: "a", tool: "pen", color: "#1c1c1e", width: 5, points: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3] },
    ]);
  });

  it("won't let anyone extend another person's stroke, or a finished one", () => {
    const board = new Board();
    board.draw("a", draw("s1", [0.1, 0.1]));
    expect(board.draw("b", draw("s1", [0.5, 0.5]))).toEqual({ ok: false, reason: "invalid" });

    board.draw("a", draw("s1", [0.2, 0.2], true));
    expect(board.draw("a", draw("s1", [0.3, 0.3]))).toEqual({ ok: false, reason: "invalid" });
    expect(board.snapshot()[0]?.points).toEqual([0.1, 0.1, 0.2, 0.2]);
  });

  it("undo removes only your own most recent finished stroke", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1], true));
    board.draw("b", draw("b1", [0.2, 0.2], true));
    board.draw("a", draw("a2", [0.3, 0.3], true));

    expect(board.undo("a")).toBe("a2");
    expect(board.snapshot().map((s) => s.id)).toEqual(["a1", "b1"]);
    expect(board.undo("a")).toBe("a1");
    expect(board.undo("a")).toBeNull();
    expect(board.snapshot().map((s) => s.id)).toEqual(["b1"]);
  });

  it("skips a stroke still being drawn when undoing", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1], true));
    board.draw("a", draw("a2", [0.2, 0.2])); // not finished
    expect(board.undo("a")).toBe("a1");
  });

  it("redo restores strokes in reverse order of undo, rebuilding the original board", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1], true));
    board.draw("a", draw("a2", [0.2, 0.2], true));
    board.undo("a");
    board.undo("a");

    expect(board.redo("a")?.id).toBe("a1");
    expect(board.redo("a")?.id).toBe("a2");
    expect(board.redo("a")).toBeNull();
    expect(board.snapshot().map((s) => s.id)).toEqual(["a1", "a2"]);
  });

  it("drawing something new ends the redo history", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1], true));
    board.undo("a");
    board.draw("a", draw("a2", [0.2, 0.2], true));
    expect(board.redo("a")).toBeNull();
  });

  it("keeps redo history separate for each person", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1], true));
    board.undo("a");
    expect(board.redo("b")).toBeNull();
    expect(board.redo("a")?.id).toBe("a1");
  });

  it("clear empties the board and every redo history", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1], true));
    board.undo("a");
    board.draw("b", draw("b1", [0.2, 0.2], true));
    board.clear();
    expect(board.snapshot()).toEqual([]);
    expect(board.redo("a")).toBeNull();
  });

  it("keeps a departed person's drawings but freezes them", () => {
    const board = new Board();
    board.draw("a", draw("a1", [0.1, 0.1]));
    board.release("a");
    expect(board.snapshot()).toHaveLength(1);
    expect(board.draw("a", draw("a1", [0.2, 0.2]))).toEqual({ ok: false, reason: "invalid" });
  });

  it("stops accepting strokes when the board is full", () => {
    const board = new Board({ ...DEFAULT_BOARD_LIMITS, maxStrokes: 2 });
    board.draw("a", draw("s1", [0.1, 0.1], true));
    board.draw("a", draw("s2", [0.1, 0.1], true));
    expect(board.draw("a", draw("s3", [0.1, 0.1], true))).toEqual({ ok: false, reason: "full" });
  });

  it("caps total size and single-stroke size", () => {
    const board = new Board({ ...DEFAULT_BOARD_LIMITS, maxNumbers: 6, maxNumbersPerStroke: 4 });
    board.draw("a", draw("s1", [0.1, 0.1, 0.2, 0.2]));
    expect(board.draw("a", draw("s1", [0.3, 0.3]))).toEqual({ ok: false, reason: "invalid" });
    expect(board.draw("a", draw("s2", [0.1, 0.1, 0.2, 0.2]))).toEqual({ ok: false, reason: "full" });
  });

  it("frees space when a stroke is undone", () => {
    const board = new Board({ ...DEFAULT_BOARD_LIMITS, maxNumbers: 4 });
    board.draw("a", draw("s1", [0.1, 0.1, 0.2, 0.2], true));
    expect(board.draw("a", draw("s2", [0.1, 0.1], true))).toEqual({ ok: false, reason: "full" });
    board.undo("a");
    expect(board.draw("a", draw("s2", [0.1, 0.1], true))).toEqual({ ok: true });
  });
});
