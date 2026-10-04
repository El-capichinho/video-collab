import { describe, expect, it } from "vitest";
import { ERASER_SCALE, renderStroke } from "./render";

function fakeContext() {
  const calls: Array<[string, ...unknown[]]> = [];
  const record = (name: string) => (...args: unknown[]) => void calls.push([name, ...args]);
  const ctx = {
    save: record("save"),
    restore: record("restore"),
    beginPath: record("beginPath"),
    moveTo: record("moveTo"),
    lineTo: record("lineTo"),
    stroke: record("stroke"),
    arc: record("arc"),
    fill: record("fill"),
    globalCompositeOperation: "source-over",
    lineWidth: 0,
    strokeStyle: "",
    fillStyle: "",
    lineCap: "",
    lineJoin: "",
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, raw: ctx, calls };
}

const size = { w: 1000, h: 500 };
const pen = (points: number[]) => ({ tool: "pen" as const, color: "#0a84ff", width: 5, points });

describe("renderStroke", () => {
  it("scales normalized points to the canvas", () => {
    const { ctx, calls } = fakeContext();
    renderStroke(ctx, pen([0.1, 0.2, 0.5, 0.5]), size);
    expect(calls.filter(([n]) => n === "moveTo" || n === "lineTo")).toEqual([
      ["moveTo", 100, 100],
      ["lineTo", 500, 250],
    ]);
  });

  it("draws a dot for a single tap", () => {
    const { ctx, calls } = fakeContext();
    renderStroke(ctx, pen([0.5, 0.5]), size);
    expect(calls.some(([n]) => n === "arc")).toBe(true);
    expect(calls.some(([n]) => n === "lineTo")).toBe(false);
  });

  it("draws only the new part when given a starting point", () => {
    const { ctx, calls } = fakeContext();
    renderStroke(ctx, pen([0.1, 0.1, 0.2, 0.2, 0.3, 0.3, 0.4, 0.4]), size, 2);
    expect(calls.filter(([n]) => n === "moveTo")).toEqual([["moveTo", 300, 150]]);
    expect(calls.filter(([n]) => n === "lineTo")).toEqual([["lineTo", 400, 200]]);
  });

  it("makes the eraser cut through what is underneath, and wider than a pen", () => {
    const { ctx, raw } = fakeContext();
    let compositeWhileDrawing = "";
    (raw as { stroke: () => void }).stroke = () => (compositeWhileDrawing = raw.globalCompositeOperation);
    renderStroke(ctx, { ...pen([0.1, 0.1, 0.2, 0.2]), tool: "eraser" }, size);
    expect(compositeWhileDrawing).toBe("destination-out");
    expect(raw.lineWidth).toBe(5 * ERASER_SCALE);
  });

  it("does nothing for an empty stroke", () => {
    const { ctx, calls } = fakeContext();
    renderStroke(ctx, pen([]), size);
    expect(calls).toEqual([]);
  });
});
