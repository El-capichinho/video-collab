import { useEffect, useRef, type PointerEvent } from "react";
import { renderStroke } from "../../core/board/render";
import type { StrokeStyle, Whiteboard } from "../../core/board/Whiteboard";

interface Props {
  board: Whiteboard;
  style: StrokeStyle;
}

export function WhiteboardCanvas({ board, style }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0 });
  const activeStroke = useRef<string | null>(null);
  const styleRef = useRef(style);
  styleRef.current = style;

  // Keep the canvas sharp at any size and repaint from the board's strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const repaint = () => {
      ctx.clearRect(0, 0, size.current.w, size.current.h);
      for (const stroke of board.allStrokes) renderStroke(ctx, stroke, size.current);
    };
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      size.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * ratio);
      canvas.height = Math.round(rect.height * ratio);
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      repaint();
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const stopListening = board.onEvent((event) => {
      if (event.type === "reset") return repaint();
      const stroke = board.strokeById(event.strokeId);
      if (stroke) renderStroke(ctx, stroke, size.current, event.fromPoint); // paint only what's new
    });
    return () => {
      observer.disconnect();
      stopListening();
    };
  }, [board]);

  const toBoard = (clientX: number, clientY: number): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return [0, 0];
    return [(clientX - rect.left) / rect.width, (clientY - rect.top) / rect.height];
  };

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId); // keep receiving moves if the pointer leaves the board
    const [x, y] = toBoard(e.clientX, e.clientY);
    activeStroke.current = board.beginStroke(styleRef.current, x, y);
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    const id = activeStroke.current;
    if (!id) return;
    // Fast strokes produce several positions per frame; use them all for a smooth line.
    const coalesced = e.nativeEvent.getCoalescedEvents?.() ?? [];
    const source = coalesced.length > 0 ? coalesced : [e.nativeEvent];
    board.addPoints(id, source.flatMap((p) => toBoard(p.clientX, p.clientY)));
  };

  const finish = () => {
    if (activeStroke.current) board.endStroke(activeStroke.current);
    activeStroke.current = null;
  };

  return (
    <canvas
      ref={canvasRef}
      className="board-canvas"
      role="img"
      aria-label="Shared whiteboard"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
    />
  );
}
