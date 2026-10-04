import { z } from "zod";

/**
 * Whiteboard contracts. Coordinates are fractions of the board (0 to 1), so a stroke
 * looks the same on every screen. Points are stored flat: [x0, y0, x1, y1, ...].
 */

export const BoardTool = z.enum(["pen", "eraser"]);
export type BoardTool = z.infer<typeof BoardTool>;

const Coordinate = z.number().min(0).max(1);

/** A batch of points for one stroke. A stroke arrives as several batches; the last has end = true. */
export const BoardDraw = z.object({
  strokeId: z.string().min(1).max(64),
  tool: BoardTool,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors are #rrggbb"),
  /** Thickness in board units (the board is 1000 units wide). Erasers are drawn wider. */
  width: z.number().min(0.5).max(40),
  points: z
    .array(Coordinate)
    .max(400)
    .refine((p) => p.length % 2 === 0, "Points come in x, y pairs"),
  end: z.boolean(),
});
export type BoardDraw = z.infer<typeof BoardDraw>;

export type BoardDrawEvent = BoardDraw & { ownerId: string };

export interface Stroke {
  id: string;
  /** The socket that drew it. Undo only ever touches your own strokes. */
  ownerId: string;
  tool: BoardTool;
  color: string;
  width: number;
  points: number[];
}
