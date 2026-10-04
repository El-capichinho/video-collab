import { io, type Socket } from "socket.io-client";
import type {
  BoardDraw,
  BoardDrawEvent,
  ClientToServerEvents,
  FileInfo,
  JoinRoomPayload,
  MediaState,
  Participant,
  ServerToClientEvents,
  ShareState,
  Stroke,
} from "@vc/shared";
import type { SignalMessage, SignalingChannel } from "../rtc/signaling";
import { PeerChannel } from "./PeerChannel";

export interface RoomEvents {
  onJoined?: (self: Participant, peers: Participant[]) => void;
  onPeerJoined?: (peer: Participant) => void;
  onPeerLeft?: (peerId: string) => void;
  onPeerMedia?: (peerId: string, media: MediaState) => void;
  onPeerShare?: (peerId: string, share: ShareState) => void;
  /** Someone else is already presenting. */
  onShareRejected?: (message: string) => void;
  onBoardSync?: (strokes: Stroke[]) => void;
  onBoardDraw?: (draw: BoardDrawEvent) => void;
  onBoardAdd?: (stroke: Stroke) => void;
  onBoardRemove?: (strokeId: string, by: string) => void;
  onBoardCleared?: () => void;
  onBoardRejected?: (message: string) => void;
  onFilesSync?: (files: FileInfo[]) => void;
  onFileAdded?: (file: FileInfo) => void;
  onFileRemoved?: (fileId: string) => void;
  /** Server rejected the request (invalid input, room full) or was unreachable. */
  onError?: (message: string) => void;
  /** The connection dropped after we had connected. */
  onDisconnect?: () => void;
}

type RoomSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Wraps the Socket.io connection. Hands out one SignalingChannel per remote
 * peer, so PeerConnectionManager never knows Socket.io exists.
 *
 * Auto-reconnect is off on purpose: a new socket gets a new id and is no longer
 * in the room, so every peer connection would be stale. The user rejoins instead.
 */
export class RoomClient {
  private readonly socket: RoomSocket;
  private readonly channels = new Map<string, PeerChannel>();
  private pendingJoin: (() => void) | null = null;

  constructor(
    url: string,
    getToken: () => Promise<string>,
    private readonly events: RoomEvents = {},
  ) {
    this.socket = io(url, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      // Called on every connect, so the token is fresh even after a long idle.
      auth: (send) => {
        getToken()
          .then((token) => send({ token }))
          .catch(() => send({ token: "" }));
      },
    });

    this.socket.on("room:joined", ({ self, peers }) => events.onJoined?.(self, peers));
    this.socket.on("room:peer-joined", (peer) => events.onPeerJoined?.(peer));
    this.socket.on("room:peer-left", (id) => {
      this.removeChannel(id);
      events.onPeerLeft?.(id);
    });
    this.socket.on("room:peer-media", ({ peerId, micOn, camOn }) => events.onPeerMedia?.(peerId, { micOn, camOn }));
    this.socket.on("room:peer-share", ({ peerId, streamId }) => events.onPeerShare?.(peerId, { streamId }));
    this.socket.on("share:rejected", ({ message }) => events.onShareRejected?.(message));
    this.socket.on("board:sync", ({ strokes }) => events.onBoardSync?.(strokes));
    this.socket.on("board:draw", (draw) => events.onBoardDraw?.(draw));
    this.socket.on("board:add", ({ stroke }) => events.onBoardAdd?.(stroke));
    this.socket.on("board:remove", ({ strokeId, by }) => events.onBoardRemove?.(strokeId, by));
    this.socket.on("board:cleared", () => events.onBoardCleared?.());
    this.socket.on("board:rejected", ({ message }) => events.onBoardRejected?.(message));
    this.socket.on("files:sync", ({ files }) => events.onFilesSync?.(files));
    this.socket.on("file:added", ({ file }) => events.onFileAdded?.(file));
    this.socket.on("file:removed", ({ fileId }) => events.onFileRemoved?.(fileId));
    this.socket.on("room:error", ({ message }) => events.onError?.(message));
    this.socket.on("signal", (payload) => {
      const message: SignalMessage =
        payload.kind === "description"
          ? { kind: "description", description: payload.description }
          : { kind: "ice", candidate: payload.candidate as RTCIceCandidateInit };
      this.channel(payload.from).receive(message);
    });
    this.socket.on("connect_error", (error) => {
      this.clearPendingJoin();
      events.onError?.(
        error.message === "unauthorized"
          ? "Your session has ended. Sign out and sign in again."
          : "Can't reach the call server. Check that it's running and try again.",
      );
    });
    this.socket.on("disconnect", () => events.onDisconnect?.());
  }

  join(payload: JoinRoomPayload): void {
    const send = () => {
      this.pendingJoin = null;
      this.socket.emit("room:join", payload);
    };
    if (this.socket.connected) return send();
    this.pendingJoin = send;
    this.socket.once("connect", send);
    this.socket.connect();
  }

  sendMedia(state: MediaState): void {
    if (this.socket.connected) this.socket.emit("media:state", state);
  }

  sendBoardDraw(draw: BoardDraw): void {
    if (this.socket.connected) this.socket.emit("board:draw", draw);
  }

  sendBoardUndo(): void {
    if (this.socket.connected) this.socket.emit("board:undo");
  }

  sendBoardRedo(): void {
    if (this.socket.connected) this.socket.emit("board:redo");
  }

  sendBoardClear(): void {
    if (this.socket.connected) this.socket.emit("board:clear");
  }

  sendShare(state: ShareState): void {
    if (this.socket.connected) this.socket.emit("share:state", state);
  }

  channelFor(peerId: string): SignalingChannel {
    return this.channel(peerId);
  }

  private channel(peerId: string): PeerChannel {
    let channel = this.channels.get(peerId);
    if (!channel) {
      channel = new PeerChannel((message) => this.sendSignal(peerId, message));
      this.channels.set(peerId, channel);
    }
    return channel;
  }

  removeChannel(peerId: string): void {
    this.channels.delete(peerId);
  }

  /** Leaves the room and closes the socket. No further events are delivered. */
  dispose(): void {
    this.clearPendingJoin();
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.channels.clear();
  }

  private sendSignal(to: string, message: SignalMessage): void {
    if (message.kind === "description") {
      this.socket.emit("signal", {
        kind: "description",
        to,
        description: message.description as { type: "offer" | "answer"; sdp: string },
      });
    } else {
      this.socket.emit("signal", {
        kind: "ice",
        to,
        candidate: message.candidate as unknown as Record<string, unknown>,
      });
    }
  }

  private clearPendingJoin(): void {
    if (this.pendingJoin) this.socket.off("connect", this.pendingJoin);
    this.pendingJoin = null;
  }
}
