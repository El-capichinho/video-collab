import { z } from "zod";
import type { BoardDraw, BoardDrawEvent, Stroke } from "./board.js";
import type { FileInfo } from "./files.js";

/** Single source of truth for signaling messages. Used by client (compile-time)
 *  and server (runtime validation). */

export const RoomId = z
  .string()
  .min(3, "Room names need at least 3 characters")
  .max(64, "Room names can be up to 64 characters")
  .regex(/^[a-zA-Z0-9_-]+$/, "Use letters, numbers, - or _ in room names");

// Identity comes from the signed-in account on the server, never from the client.
export const JoinRoomPayload = z.object({ roomId: RoomId });
export type JoinRoomPayload = z.infer<typeof JoinRoomPayload>;

export const SessionDescription = z.object({
  type: z.enum(["offer", "answer"]),
  sdp: z.string().max(100_000),
});

export const SignalPayload = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("description"), to: z.string(), description: SessionDescription }),
  z.object({ kind: z.literal("ice"), to: z.string(), candidate: z.record(z.unknown()) }),
]);
export type SignalPayload = z.infer<typeof SignalPayload>;

/** What a participant is currently sending. Shown on their tile for everyone else. */
export const MediaState = z.object({ micOn: z.boolean(), camOn: z.boolean() });
export type MediaState = z.infer<typeof MediaState>;

/**
 * Whether someone is presenting their screen. streamId is the id of the MediaStream
 * carrying the screen, so receivers can tell it apart from that person's camera.
 */
export const ShareState = z.object({ streamId: z.string().min(1).max(128).nullable() });
export type ShareState = z.infer<typeof ShareState>;

export interface Participant {
  id: string;
  displayName: string;
  media: MediaState;
  share: ShareState;
}

export interface ClientToServerEvents {
  "room:join": (payload: JoinRoomPayload) => void;
  "room:leave": () => void;
  "media:state": (state: MediaState) => void;
  "share:state": (state: ShareState) => void;
  "board:draw": (draw: BoardDraw) => void;
  "board:undo": () => void;
  "board:redo": () => void;
  "board:clear": () => void;
  signal: (payload: SignalPayload) => void;
}

export interface ServerToClientEvents {
  "room:joined": (payload: { self: Participant; peers: Participant[] }) => void;
  "room:peer-joined": (peer: Participant) => void;
  "room:peer-left": (peerId: string) => void;
  "room:peer-media": (payload: { peerId: string } & MediaState) => void;
  "room:peer-share": (payload: { peerId: string } & ShareState) => void;
  /** Someone else is already presenting. */
  "share:rejected": (payload: { message: string }) => void;
  /** Files already shared in the room, sent to someone who has just joined. Bytes travel over HTTP. */
  "files:sync": (payload: { files: FileInfo[] }) => void;
  "file:added": (payload: { file: FileInfo }) => void;
  "file:removed": (payload: { fileId: string }) => void;
  /** The whole board, sent to someone who has just joined. */
  "board:sync": (payload: { strokes: Stroke[] }) => void;
  "board:draw": (draw: BoardDrawEvent) => void;
  /** A stroke put back by redo. */
  "board:add": (payload: { stroke: Stroke }) => void;
  "board:remove": (payload: { strokeId: string; by: string }) => void;
  "board:cleared": () => void;
  "board:rejected": (payload: { message: string }) => void;
  "room:error": (payload: { code: "invalid_payload" | "room_full"; message: string }) => void;
  signal: (payload: { from: string } & SignalPayload) => void;
}
