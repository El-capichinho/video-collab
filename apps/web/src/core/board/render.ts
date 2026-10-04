import type { Stroke } from "@vc/shared";

/** The board is 1000 units wide; stroke widths are in these units so lines scale with the board. */
export const BOARD_UNITS = 1000;
/** An eraser needs to be much wider than a pen to be useful. */
export const ERASER_SCALE = 4;

type Drawable = Pick<Stroke, "tool" | "color" | "width" | "points">;

/**
 * Draws a stroke, or just its newest part (from point `fromPoint` on), so live
 * drawing only paints what is new. Erasing cuts through earlier strokes.
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Drawable,
  size: { w: number; h: number },
  fromPoint = 0,
): void {
  const pts = stroke.points;
  const count = Math.floor(pts.length / 2);
  if (count === 0) return;

  const at = (i: number) => pts[i] ?? 0;
  const scale = stroke.tool === "eraser" ? ERASER_SCALE : 1;
  const lineWidth = stroke.width * scale * (size.w / BOARD_UNITS);

  ctx.save();
  ctx.globalCompositeOperation = stroke.tool === "eraser" ? "destination-out" : "source-over";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  if (count === 1) {
    ctx.arc(at(0) * size.w, at(1) * size.h, lineWidth / 2, 0, Math.PI * 2); // a tap makes a dot
    ctx.fill();
  } else {
    const start = Math.max(0, Math.min(fromPoint, count - 2));
    ctx.moveTo(at(start * 2) * size.w, at(start * 2 + 1) * size.h);
    for (let i = start + 1; i < count; i++) ctx.lineTo(at(i * 2) * size.w, at(i * 2 + 1) * size.h);
    ctx.stroke();
  }
  ctx.restore();
}
