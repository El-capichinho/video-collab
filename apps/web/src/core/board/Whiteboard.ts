import type { BoardDrawEvent, BoardTool, Stroke } from "@vc/shared";
import type { BoardPort, BoardSender } from "./types";

/** Points closer than this (a fraction of the board) add nothing visible, so they are dropped. */
const MIN_STEP = 0.0015;
/** Matches the server's limit on numbers per message. */
const MAX_NUMBERS_PER_MESSAGE = 400;

/** Four decimals is well under a pixel on any screen, and keeps messages small. */
const quantize = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 10_000) / 10_000;

export interface StrokeStyle {
  tool: BoardTool;
  color: string;
  width: number;
}

/** What React needs to know. Deliberately excludes the strokes, which change constantly. */
export interface BoardSnapshot {
  canDraw: boolean;
  canUndo: boolean;
  canRedo: boolean;
  hasContent: boolean;
  /** Counts changes made by other people, so a closed board can show a badge. */
  remoteActivity: number;
}

/** What the canvas needs to know to repaint efficiently. */
export type BoardEvent =
  | { type: "append"; strokeId: string; fromPoint: number }
  | { type: "reset" };

export interface WhiteboardOptions {
  /** How often drawing is sent to the server while a stroke is in progress. */
  flushMs?: number;
}

interface PendingSend {
  points: number[];
  end: boolean;
}

/**
 * The shared whiteboard as seen from one browser. Holds every stroke, sends our
 * drawing to the server in small batches, and applies what the server tells us.
 * No React and no canvas in here, so it is tested on its own.
 */
export class Whiteboard implements BoardPort {
  private strokes: Stroke[] = [];
  private readonly byId = new Map<string, Stroke>();
  private readonly pending = new Map<string, PendingSend>();
  private sender: BoardSender | null = null;
  private selfId: string | null = null;
  private redoCount = 0;
  private remoteActivity = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private snapshot: BoardSnapshot = {
    canDraw: false,
    canUndo: false,
    canRedo: false,
    hasContent: false,
    remoteActivity: 0,
  };
  private readonly listeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: BoardEvent) => void>();
  private readonly flushMs: number;

  constructor(options: WhiteboardOptions = {}) {
    this.flushMs = options.flushMs ?? 40;
  }

  // ---- React binding ----

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): BoardSnapshot => this.snapshot;

  // ---- Canvas binding ----

  onEvent(listener: (event: BoardEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  /** In drawing order: later strokes paint over earlier ones. */
  get allStrokes(): readonly Stroke[] {
    return this.strokes;
  }

  strokeById(id: string): Stroke | undefined {
    return this.byId.get(id);
  }

  // ---- Connection ----

  attach(sender: BoardSender, selfId: string): void {
    this.sender = sender;
    this.selfId = selfId;
    this.refresh();
  }

  detach(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending.clear();
    this.sender = null;
    this.selfId = null;
    this.redoCount = 0;
    this.remoteActivity = 0;
    this.replaceAll([]);
  }

  // ---- Drawing (this person) ----

  /** Starts a stroke at (x, y), both 0 to 1. Returns null if not in a room. */
  beginStroke(style: StrokeStyle, x: number, y: number): string | null {
    if (!this.sender || !this.selfId) return null;
    const id = crypto.randomUUID();
    const stroke: Stroke = { id, ownerId: this.selfId, ...style, points: [quantize(x), quantize(y)] };
    this.strokes.push(stroke);
    this.byId.set(id, stroke);
    this.redoCount = 0; // drawing something new ends the redo history
    this.pending.set(id, { points: [...stroke.points], end: false });
    this.emit({ type: "append", strokeId: id, fromPoint: 0 });
    this.scheduleFlush();
    this.refresh();
    return id;
  }

  /** Adds points as a flat [x, y, x, y, ...] list. */
  addPoints(strokeId: string, flat: number[]): void {
    const stroke = this.byId.get(strokeId);
    const pending = this.pending.get(strokeId);
    if (!stroke || !pending) return;

    const before = stroke.points.length / 2;
    for (let i = 0; i + 1 < flat.length; i += 2) {
      const x = quantize(flat[i] ?? 0);
      const y = quantize(flat[i + 1] ?? 0);
      const lastX = stroke.points[stroke.points.length - 2] ?? x;
      const lastY = stroke.points[stroke.points.length - 1] ?? y;
      if (Math.hypot(x - lastX, y - lastY) < MIN_STEP) continue;
      stroke.points.push(x, y);
      pending.points.push(x, y);
    }
    if (stroke.points.length / 2 > before) {
      this.emit({ type: "append", strokeId, fromPoint: Math.max(0, before - 1) });
      this.scheduleFlush();
    }
  }

  endStroke(strokeId: string): void {
    if (!this.byId.has(strokeId)) return;
    const pending = this.pending.get(strokeId) ?? { points: [], end: false };
    pending.end = true;
    this.pending.set(strokeId, pending);
    this.flush();
  }

  undo(): void {
    if (this.snapshot.canUndo) this.sender?.sendBoardUndo();
  }

  redo(): void {
    if (this.snapshot.canRedo) this.sender?.sendBoardRedo();
  }

  clear(): void {
    this.sender?.sendBoardClear();
  }

  // ---- Changes from the server ----

  applySync(strokes: Stroke[]): void {
    this.redoCount = 0;
    this.replaceAll(strokes);
  }

  applyDraw(draw: BoardDrawEvent): void {
    let stroke = this.byId.get(draw.strokeId);
    const before = stroke ? stroke.points.length / 2 : 0;
    if (!stroke) {
      stroke = { id: draw.strokeId, ownerId: draw.ownerId, tool: draw.tool, color: draw.color, width: draw.width, points: [] };
      this.strokes.push(stroke);
      this.byId.set(stroke.id, stroke);
    }
    stroke.points.push(...draw.points);
    this.remoteActivity++;
    if (draw.points.length > 0) this.emit({ type: "append", strokeId: stroke.id, fromPoint: Math.max(0, before - 1) });
    this.refresh();
  }

  /** A stroke put back by redo. */
  applyAdd(stroke: Stroke): void {
    if (this.byId.has(stroke.id)) return;
    const copy = { ...stroke, points: [...stroke.points] };
    this.strokes.push(copy);
    this.byId.set(copy.id, copy);
    if (copy.ownerId === this.selfId) this.redoCount = Math.max(0, this.redoCount - 1);
    else this.remoteActivity++;
    this.emit({ type: "append", strokeId: copy.id, fromPoint: 0 });
    this.refresh();
  }

  applyRemove(strokeId: string, by: string): void {
    if (!this.byId.has(strokeId)) return;
    this.strokes = this.strokes.filter((s) => s.id !== strokeId);
    this.byId.delete(strokeId);
    this.pending.delete(strokeId);
    if (by === this.selfId) this.redoCount++;
    else this.remoteActivity++;
    this.emit({ type: "reset" });
    this.refresh();
  }

  applyCleared(): void {
    this.pending.clear();
    this.redoCount = 0;
    this.remoteActivity++;
    this.replaceAll([]);
  }

  // ---- internals ----

  private replaceAll(strokes: Stroke[]): void {
    this.strokes = strokes.map((s) => ({ ...s, points: [...s.points] }));
    this.byId.clear();
    for (const s of this.strokes) this.byId.set(s.id, s);
    this.emit({ type: "reset" });
    this.refresh();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), this.flushMs);
  }

  /** Sends everything drawn since the last flush, split to fit the server's message limit. */
  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const sender = this.sender;
    if (!sender) {
      this.pending.clear();
      return;
    }
    for (const [id, pending] of this.pending) {
      const stroke = this.byId.get(id);
      if (!stroke) continue;
      const chunks: number[][] = [];
      for (let i = 0; i < pending.points.length; i += MAX_NUMBERS_PER_MESSAGE) {
        chunks.push(pending.points.slice(i, i + MAX_NUMBERS_PER_MESSAGE));
      }
      if (chunks.length === 0 && pending.end) chunks.push([]); // just the "finished" marker
      chunks.forEach((points, i) =>
        sender.sendBoardDraw({
          strokeId: id,
          tool: stroke.tool,
          color: stroke.color,
          width: stroke.width,
          points,
          end: pending.end && i === chunks.length - 1,
        }),
      );
    }
    this.pending.clear();
  }

  private emit(event: BoardEvent): void {
    this.eventListeners.forEach((l) => l(event));
  }

  /** Only tells React when something it displays has actually changed. */
  private refresh(): void {
    const next: BoardSnapshot = {
      canDraw: this.sender !== null,
      canUndo: this.selfId !== null && this.strokes.some((s) => s.ownerId === this.selfId),
      canRedo: this.redoCount > 0,
      hasContent: this.strokes.length > 0,
      remoteActivity: this.remoteActivity,
    };
    const prev = this.snapshot;
    const same =
      prev.canDraw === next.canDraw &&
      prev.canUndo === next.canUndo &&
      prev.canRedo === next.canRedo &&
      prev.hasContent === next.hasContent &&
      prev.remoteActivity === next.remoteActivity;
    if (same) return;
    this.snapshot = next;
    this.listeners.forEach((l) => l());
  }
}
