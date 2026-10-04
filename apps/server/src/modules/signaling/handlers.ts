import type { Server } from "socket.io";
import {
  BoardDraw,
  JoinRoomPayload,
  MediaState,
  ShareState,
  SignalPayload,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from "@vc/shared";
import type { FileInfo } from "@vc/shared";
import type { TokenService } from "../auth/tokens";
import { RoomDirectory, type RoomMember } from "../rooms/directory";
import { Board, DEFAULT_BOARD_LIMITS, type BoardLimits } from "../board/board";

export interface SocketData {
  user: { id: string; displayName: string };
}

export type SignalingServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

/** Refuses any socket that doesn't present a valid access token in its handshake. */
export function requireSocketAuth(io: SignalingServer, tokens: TokenService): void {
  io.use(async (socket, next) => {
    try {
      const token: unknown = socket.handshake.auth?.token;
      if (typeof token !== "string" || token === "") throw new Error("missing token");
      socket.data.user = await tokens.verifyAccess(token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });
}

export interface SignalingOptions {
  maxRoomSize: number;
  boardLimits?: Partial<BoardLimits>;
  directory?: RoomDirectory;
  /** Lets the room announce existing files to newcomers and clean up when it empties. */
  files?: {
    list(roomId: string): FileInfo[];
    roomEmptied(roomId: string): void;
  };
}

export function registerSignalingHandlers(io: SignalingServer, opts: SignalingOptions): void {
  /** In-memory registries. Replaced by a RoomRepository (Redis/DB) later. */
  const rooms = (opts.directory ?? new RoomDirectory()).rooms; // roomId -> (socketId -> member)
  const boards = new Map<string, Board>(); // roomId -> whiteboard
  const boardLimits = { ...DEFAULT_BOARD_LIMITS, ...opts.boardLimits };

  io.on("connection", (socket) => {
    let currentRoom: string | null = null;

    const leave = () => {
      if (!currentRoom) return;
      const members = rooms.get(currentRoom);
      members?.delete(socket.id);
      boards.get(currentRoom)?.release(socket.id);
      socket.to(currentRoom).emit("room:peer-left", socket.id);
      if (members?.size === 0) {
        rooms.delete(currentRoom);
        boards.delete(currentRoom); // an empty room forgets its board...
        opts.files?.roomEmptied(currentRoom); // ...and its files
      }
      void socket.leave(currentRoom);
      currentRoom = null;
    };

    const boardOfRoom = () => (currentRoom ? boards.get(currentRoom) : undefined);

    socket.on("room:join", (raw) => {
      const parsed = JoinRoomPayload.safeParse(raw);
      if (!parsed.success) {
        socket.emit("room:error", { code: "invalid_payload", message: parsed.error.issues[0]?.message ?? "Invalid room name." });
        return;
      }
      leave();
      const { roomId } = parsed.data;
      const { displayName } = socket.data.user; // trusted: comes from the verified token
      const members = rooms.get(roomId) ?? new Map<string, RoomMember>();
      if (members.size >= opts.maxRoomSize) {
        socket.emit("room:error", {
          code: "room_full",
          message: `This room is full (up to ${opts.maxRoomSize} people).`,
        });
        return;
      }
      const peers = [...members].map(([id, m]) => ({
        id,
        displayName: m.displayName,
        media: m.media,
        share: m.share,
      }));
      const media: MediaState = { micOn: true, camOn: true };
      const share: ShareState = { streamId: null };
      members.set(socket.id, { userId: socket.data.user.id, displayName, media, share });
      rooms.set(roomId, members);
      const board = boards.get(roomId) ?? new Board(boardLimits);
      boards.set(roomId, board);

      currentRoom = roomId;
      void socket.join(roomId);
      socket.emit("room:joined", { self: { id: socket.id, displayName, media, share }, peers });
      socket.emit("board:sync", { strokes: board.snapshot() });
      socket.emit("files:sync", { files: opts.files?.list(roomId) ?? [] });
      socket.to(roomId).emit("room:peer-joined", { id: socket.id, displayName, media, share });
    });

    socket.on("media:state", (raw) => {
      const parsed = MediaState.safeParse(raw);
      const member = currentRoom ? rooms.get(currentRoom)?.get(socket.id) : undefined;
      if (!parsed.success || !currentRoom || !member) return;
      member.media = parsed.data;
      socket.to(currentRoom).emit("room:peer-media", { peerId: socket.id, ...parsed.data });
    });

    socket.on("share:state", (raw) => {
      const parsed = ShareState.safeParse(raw);
      const members = currentRoom ? rooms.get(currentRoom) : undefined;
      const member = members?.get(socket.id);
      if (!parsed.success || !currentRoom || !members || !member) return;

      // One presenter at a time: in a mesh, each extra screen multiplies everyone's bandwidth.
      const someoneElse = [...members].some(([id, m]) => id !== socket.id && m.share.streamId !== null);
      if (parsed.data.streamId !== null && someoneElse) {
        socket.emit("share:rejected", { message: "Someone else is already sharing their screen." });
        return;
      }
      member.share = parsed.data;
      socket.to(currentRoom).emit("room:peer-share", { peerId: socket.id, ...parsed.data });
    });

    socket.on("board:draw", (raw) => {
      const parsed = BoardDraw.safeParse(raw);
      const board = boardOfRoom();
      if (!parsed.success || !board || !currentRoom) return;

      const result = board.draw(socket.id, parsed.data);
      if (!result.ok) {
        if (result.reason === "full") {
          socket.emit("board:rejected", { message: "The whiteboard is full. Clear it to keep drawing." });
        }
        return;
      }
      socket.to(currentRoom).emit("board:draw", { ownerId: socket.id, ...parsed.data });
    });

    socket.on("board:undo", () => {
      const strokeId = boardOfRoom()?.undo(socket.id);
      if (strokeId && currentRoom) io.to(currentRoom).emit("board:remove", { strokeId, by: socket.id });
    });

    socket.on("board:redo", () => {
      const stroke = boardOfRoom()?.redo(socket.id);
      if (stroke && currentRoom) io.to(currentRoom).emit("board:add", { stroke });
    });

    socket.on("board:clear", () => {
      const board = boardOfRoom();
      if (!board || !currentRoom) return;
      board.clear();
      io.to(currentRoom).emit("board:cleared");
    });

    socket.on("signal", (raw) => {
      const parsed = SignalPayload.safeParse(raw);
      if (!parsed.success || !currentRoom) return;
      // Only relay to someone in the same room.
      if (!rooms.get(currentRoom)?.has(parsed.data.to)) return;
      io.to(parsed.data.to).emit("signal", { from: socket.id, ...parsed.data });
    });

    socket.on("room:leave", leave);
    socket.on("disconnect", leave);
  });
}
