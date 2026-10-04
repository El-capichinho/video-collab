import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardDraw, Stroke } from "@vc/shared";
import { Whiteboard, type BoardEvent, type StrokeStyle } from "./Whiteboard";
import type { BoardSender } from "./types";

const PEN: StrokeStyle = { tool: "pen", color: "#0a84ff", width: 5 };
const ME = "me";

class FakeSender implements BoardSender {
  draws: BoardDraw[] = [];
  undos = 0;
  redos = 0;
  clears = 0;
  sendBoardDraw(d: BoardDraw) { this.draws.push(d); }
  sendBoardUndo() { this.undos++; }
  sendBoardRedo() { this.redos++; }
  sendBoardClear() { this.clears++; }
}

const stroke = (id: string, ownerId: string, points = [0.1, 0.1]): Stroke => ({ id, ownerId, tool: "pen", color: "#000000", width: 5, points });

function setup() {
  const board = new Whiteboard({ flushMs: 40 });
  const sender = new FakeSender();
  board.attach(sender, ME);
  const events: BoardEvent[] = [];
  board.onEvent((e) => events.push(e));
  return { board, sender, events };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Whiteboard: drawing", () => {
  it("cannot draw until connected to a room", () => {
    const board = new Whiteboard();
    expect(board.beginStroke(PEN, 0.5, 0.5)).toBeNull();
    expect(board.getSnapshot().canDraw).toBe(false);
  });

  it("shows the stroke immediately, and sends it in batches rather than point by point", () => {
    const { board, sender } = setup();
    const id = board.beginStroke(PEN, 0.1, 0.1)!;
    board.addPoints(id, [0.2, 0.2]);
    board.addPoints(id, [0.3, 0.3]);
    expect(board.strokeById(id)?.points).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
    expect(sender.draws).toHaveLength(0);

    vi.advanceTimersByTime(40);
    expect(sender.draws).toHaveLength(1);
    expect(sender.draws[0]).toMatchObject({ strokeId: id, points: [0.1, 0.1, 0.2, 0.2, 0.3, 0.3], end: false });
  });

  it("sends whatever is left, marked as finished, the moment the stroke ends", () => {
    const { board, sender } = setup();
    const id = board.beginStroke(PEN, 0.1, 0.1)!;
    board.addPoints(id, [0.5, 0.5]);
    board.endStroke(id);
    expect(sender.draws).toEqual([expect.objectContaining({ points: [0.1, 0.1, 0.5, 0.5], end: true })]);
    vi.advanceTimersByTime(100);
    expect(sender.draws).toHaveLength(1); // nothing sent twice
  });

  it("still sends the finished marker if every point already went out", () => {
    const { board, sender } = setup();
    const id = board.beginStroke(PEN, 0.1, 0.1)!;
    vi.advanceTimersByTime(40);
    board.endStroke(id);
    expect(sender.draws.at(-1)).toMatchObject({ points: [], end: true });
  });

  it("drops points too close together to see", () => {
    const { board } = setup();
    const id = board.beginStroke(PEN, 0.5, 0.5)!;
    board.addPoints(id, [0.5005, 0.5005, 0.5002, 0.5]);
    expect(board.strokeById(id)?.points).toEqual([0.5, 0.5]);
  });

  it("keeps points inside the board and rounds them", () => {
    const { board } = setup();
    const id = board.beginStroke(PEN, -0.2, 0.123456789)!;
    board.addPoints(id, [1.4, 0.9])
    expect(board.strokeById(id)?.points).toEqual([0, 0.1235, 1, 0.9]);
  });

  it("splits a very long stroke into messages the server will accept", () => {
    const { board, sender } = setup();
    const id = board.beginStroke(PEN, 0, 0)!;
    const many: number[] = [];
    for (let i = 1; i <= 300; i++) many.push(i / 400, i / 400);
    board.addPoints(id, many);
    board.endStroke(id);

    expect(sender.draws.length).toBeGreaterThan(1);
    for (const d of sender.draws) expect(d.points.length).toBeLessThanOrEqual(400);
    expect(sender.draws.map((d) => d.end)).toEqual(sender.draws.map((_, i) => i === sender.draws.length - 1));
  });

  it("tells the canvas which part is new, so it repaints only that", () => {
    const { board, events } = setup();
    const id = board.beginStroke(PEN, 0.1, 0.1)!;
    board.addPoints(id, [0.2, 0.2]);
    board.addPoints(id, [0.3, 0.3]);
    expect(events).toEqual([
      { type: "append", strokeId: id, fromPoint: 0 },
      { type: "append", strokeId: id, fromPoint: 0 },
      { type: "append", strokeId: id, fromPoint: 1 },
    ]);
  });
});

describe("Whiteboard: other people's changes", () => {
  it("builds someone else's stroke from batches", () => {
    const { board, events } = setup();
    const draw = { strokeId: "s1", ownerId: "kofi", tool: "pen" as const, color: "#ff453a", width: 5 };
    board.applyDraw({ ...draw, points: [0.1, 0.1, 0.2, 0.2], end: false });
    board.applyDraw({ ...draw, points: [0.3, 0.3], end: true });

    expect(board.strokeById("s1")?.points).toEqual([0.1, 0.1, 0.2, 0.2, 0.3, 0.3]);
    expect(events.at(-1)).toEqual({ type: "append", strokeId: "s1", fromPoint: 1 });
  });

  it("replaces everything on sync, and resets the canvas", () => {
    const { board, events } = setup();
    board.applySync([stroke("s1", "kofi"), stroke("s2", "esi")]);
    expect(board.allStrokes.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(events.at(-1)).toEqual({ type: "reset" });
  });

  it("removes a stroke and clears the board", () => {
    const { board } = setup();
    board.applySync([stroke("s1", "kofi"), stroke("s2", "esi")]);
    board.applyRemove("s1", "kofi");
    expect(board.allStrokes.map((s) => s.id)).toEqual(["s2"]);
    board.applyCleared();
    expect(board.allStrokes).toEqual([]);
    expect(board.getSnapshot().hasContent).toBe(false);
  });

  it("counts other people's activity so a closed board can show a badge", () => {
    const { board } = setup();
    expect(board.getSnapshot().remoteActivity).toBe(0);
    board.applyDraw({ strokeId: "s1", ownerId: "kofi", tool: "pen", color: "#000000", width: 5, points: [0.1, 0.1], end: true });
    expect(board.getSnapshot().remoteActivity).toBeGreaterThan(0);
  });

  it("ignores the same stroke being added twice", () => {
    const { board } = setup();
    board.applyAdd(stroke("s1", "kofi"));
    board.applyAdd(stroke("s1", "kofi"));
    expect(board.allStrokes).toHaveLength(1);
  });
});

describe("Whiteboard: undo and redo", () => {
  it("can only undo once you have drawn something, and asks the server to do it", () => {
    const { board, sender } = setup();
    board.applySync([stroke("theirs", "kofi")]);
    expect(board.getSnapshot().canUndo).toBe(false);
    board.undo();
    expect(sender.undos).toBe(0);

    board.applySync([stroke("mine", ME), stroke("theirs", "kofi")]);
    expect(board.getSnapshot().canUndo).toBe(true);
    board.undo();
    expect(sender.undos).toBe(1);
  });

  it("offers redo once your own stroke has been taken back, and not before", () => {
    const { board, sender } = setup();
    board.applySync([stroke("mine", ME)]);
    expect(board.getSnapshot().canRedo).toBe(false);

    board.applyRemove("mine", ME);
    expect(board.getSnapshot().canRedo).toBe(true);
    board.redo();
    expect(sender.redos).toBe(1);

    board.applyAdd(stroke("mine", ME));
    expect(board.getSnapshot().canRedo).toBe(false);
    expect(board.getSnapshot().canUndo).toBe(true);
  });

  it("does not offer redo when someone else's stroke was removed", () => {
    const { board } = setup();
    board.applySync([stroke("theirs", "kofi")]);
    board.applyRemove("theirs", "kofi");
    expect(board.getSnapshot().canRedo).toBe(false);
  });

  it("loses redo when you draw something new, or when the board is cleared", () => {
    const { board } = setup();
    board.applySync([stroke("mine", ME)]);
    board.applyRemove("mine", ME);
    board.beginStroke(PEN, 0.5, 0.5);
    expect(board.getSnapshot().canRedo).toBe(false);

    board.applyRemove(board.allStrokes[0]!.id, ME);
    expect(board.getSnapshot().canRedo).toBe(true);
    board.applyCleared();
    expect(board.getSnapshot().canRedo).toBe(false);
  });

  it("asks the server to clear", () => {
    const { board, sender } = setup();
    board.clear();
    expect(sender.clears).toBe(1);
  });
});

describe("Whiteboard: leaving", () => {
  it("empties and stops drawing when detached, discarding unsent points", () => {
    const { board, sender } = setup();
    board.beginStroke(PEN, 0.1, 0.1);
    board.detach();
    vi.advanceTimersByTime(100);
    expect(sender.draws).toEqual([]);
    expect(board.allStrokes).toEqual([]);
    expect(board.getSnapshot().canDraw).toBe(false);
  });
});

describe("Whiteboard: snapshot", () => {
  it("only notifies React when something it shows has changed", () => {
    const { board } = setup();
    const listener = vi.fn();
    board.subscribe(listener);

    const id = board.beginStroke(PEN, 0.1, 0.1)!; // first stroke: hasContent and canUndo change
    expect(listener).toHaveBeenCalledTimes(1);
    board.addPoints(id, [0.2, 0.2], );
    board.addPoints(id, [0.3, 0.3]);
    expect(listener).toHaveBeenCalledTimes(1); // more points don't re-render the app
  });
});
