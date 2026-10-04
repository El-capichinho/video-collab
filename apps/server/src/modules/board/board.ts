import type { BoardDraw, Stroke } from "@vc/shared";

export interface BoardLimits {
  maxStrokes: number;
  /** Total coordinates on the board (two per point). Keeps memory and sync size bounded. */
  maxNumbers: number;
  maxNumbersPerStroke: number;
}

export const DEFAULT_BOARD_LIMITS: BoardLimits = {
  maxStrokes: 1500,
  maxNumbers: 100_000,
  maxNumbersPerStroke: 8_000,
};

export type DrawResult = { ok: true } | { ok: false; reason: "full" | "invalid" };

/**
 * One room's whiteboard. Pure state, no sockets, so the rules are easy to test.
 * Undo and redo are per person: you can only take back your own strokes.
 */
export class Board {
  private strokes: Stroke[] = [];
  private readonly byId = new Map<string, Stroke>();
  private readonly finished = new Set<string>();
  private readonly redoStacks = new Map<string, Stroke[]>();
  private numbers = 0;

  constructor(private readonly limits: BoardLimits = DEFAULT_BOARD_LIMITS) {}

  draw(ownerId: string, draw: BoardDraw): DrawResult {
    let stroke = this.byId.get(draw.strokeId);

    if (stroke && (stroke.ownerId !== ownerId || this.finished.has(stroke.id))) {
      return { ok: false, reason: "invalid" }; // can't extend someone else's stroke, or a finished one
    }
    if (this.numbers + draw.points.length > this.limits.maxNumbers) return { ok: false, reason: "full" };
    if (!stroke && this.strokes.length >= this.limits.maxStrokes) return { ok: false, reason: "full" };
    if (stroke && stroke.points.length + draw.points.length > this.limits.maxNumbersPerStroke) {
      return { ok: false, reason: "invalid" };
    }

    if (!stroke) {
      stroke = { id: draw.strokeId, ownerId, tool: draw.tool, color: draw.color, width: draw.width, points: [] };
      this.strokes.push(stroke);
      this.byId.set(stroke.id, stroke);
      this.redoStacks.delete(ownerId); // drawing something new ends the redo history
    }
    stroke.points.push(...draw.points);
    this.numbers += draw.points.length;
    if (draw.end) this.finished.add(stroke.id);
    return { ok: true };
  }

  /** Removes the person's most recent finished stroke. Returns its id, or null if there is none. */
  undo(ownerId: string): string | null {
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const stroke = this.strokes[i]!;
      if (stroke.ownerId !== ownerId || !this.finished.has(stroke.id)) continue;
      this.strokes.splice(i, 1);
      this.byId.delete(stroke.id);
      this.finished.delete(stroke.id);
      this.numbers -= stroke.points.length;
      this.redoStacks.set(ownerId, [...(this.redoStacks.get(ownerId) ?? []), stroke]);
      return stroke.id;
    }
    return null;
  }

  /** Puts back the last stroke the person undid. */
  redo(ownerId: string): Stroke | null {
    const stack = this.redoStacks.get(ownerId);
    const stroke = stack?.pop();
    if (!stroke) return null;
    if (this.strokes.length >= this.limits.maxStrokes || this.numbers + stroke.points.length > this.limits.maxNumbers) {
      return null; // the board filled up in the meantime
    }
    this.strokes.push(stroke);
    this.byId.set(stroke.id, stroke);
    this.finished.add(stroke.id);
    this.numbers += stroke.points.length;
    return stroke;
  }

  clear(): void {
    this.strokes = [];
    this.byId.clear();
    this.finished.clear();
    this.redoStacks.clear();
    this.numbers = 0;
  }

  /** Someone left: their drawings stay, but nothing can be added to them any more. */
  release(ownerId: string): void {
    for (const stroke of this.strokes) if (stroke.ownerId === ownerId) this.finished.add(stroke.id);
    this.redoStacks.delete(ownerId);
  }

  snapshot(): Stroke[] {
    return this.strokes.map((s) => ({ ...s, points: [...s.points] }));
  }
}
