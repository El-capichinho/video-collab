import type { JoinRoomPayload, MediaState, Participant, ShareState } from "@vc/shared";
import type { BoardPort, BoardSender } from "../board/types";
import type { FilePort } from "../files/FileShelf";
import type { PeerEvents } from "../rtc/PeerConnectionManager";
import type { SignalingChannel } from "../rtc/signaling";
import type { RoomEvents } from "./RoomClient";

export interface RemotePeer {
  id: string;
  displayName: string;
  /** Their camera. */
  stream: MediaStream | null;
  /** Their screen, while they are presenting. */
  screenStream: MediaStream | null;
  state: RTCPeerConnectionState;
  micOn: boolean;
  camOn: boolean;
}

export type RoomStatus = "idle" | "joining" | "joined";

export interface MeshSnapshot {
  status: RoomStatus;
  roomId: string | null;
  peers: RemotePeer[];
  error: string | null;
  /** The screen we are sharing, if any. */
  localScreen: MediaStream | null;
  /** A short, non-fatal message for the person to read (e.g. someone else is presenting). */
  notice: string | null;
}

/** What the coordinator needs from a peer connection. PeerConnectionManager fits. */
export interface PeerHandle {
  addLocalStream(stream: MediaStream): void;
  addScreenStream(stream: MediaStream): void;
  removeScreenStream(): void;
  call(): Promise<void>;
  restartIce(): Promise<void>;
  setMaxVideoBitrate(bitsPerSecond: number | null): Promise<void>;
  setScreenBitrate(bitsPerSecond: number | null): Promise<void>;
  close(): void;
}

/** What the coordinator needs from the signaling connection. RoomClient fits. */
export interface RoomTransport extends BoardSender {
  join(payload: JoinRoomPayload): void;
  channelFor(peerId: string): SignalingChannel;
  sendMedia(state: MediaState): void;
  sendShare(state: ShareState): void;
  dispose(): void;
}

export interface MeshDeps {
  createTransport(events: RoomEvents): RoomTransport;
  createPeer(
    channel: SignalingChannel,
    events: PeerEvents,
    options: { polite: boolean; iceServers?: RTCIceServer[] },
  ): PeerHandle;
  /** Asked for before connecting, so every peer connection starts with TURN credentials. Must not reject. */
  loadIceServers?: () => Promise<RTCIceServer[]>;
  /** The shared whiteboard. Optional: a room works without one. */
  board?: BoardPort;
  /** The room's shared files. Optional too. */
  files?: FilePort;
}

const MAX_ICE_RESTARTS = 3;
/** While presenting, the camera shrinks to a thumbnail's worth of bandwidth. */
const SHARER_CAMERA_BITRATE = 250_000;

/** Every extra person multiplies upload bandwidth in a mesh, so quality steps down. */
export function videoBitrateFor(remotePeers: number): number | null {
  if (remotePeers <= 1) return null; // browser default
  if (remotePeers === 2) return 1_000_000;
  return 500_000;
}

export function screenBitrateFor(viewers: number): number {
  if (viewers <= 1) return 1_500_000;
  if (viewers === 2) return 1_200_000;
  return 800_000;
}

interface PeerEntry {
  handle: PeerHandle;
  initiator: boolean;
  restarts: number;
  /** Every stream this peer has sent: their camera first, then possibly a screen. */
  streams: MediaStream[];
  screenStreamId: string | null;
}

const IDLE: MeshSnapshot = { status: "idle", roomId: null, peers: [], error: null, localScreen: null, notice: null };

/**
 * Runs a mesh call: one peer connection per other participant.
 *
 * Rule that prevents collisions: the newcomer sends an offer to everyone already
 * in the room; people already there wait to be called (and are the "polite" side
 * if both ever offer at once). Exposes a snapshot for React's useSyncExternalStore,
 * but has no React in it, so it can be tested alone.
 */
export class MeshCoordinator {
  private snapshot: MeshSnapshot = IDLE;
  private readonly listeners = new Set<() => void>();
  private readonly entries = new Map<string, PeerEntry>();
  private transport: RoomTransport | null = null;
  private localStream: MediaStream | null = null;
  private localScreen: MediaStream | null = null;
  private media: MediaState = { micOn: true, camOn: true };
  private iceServers: RTCIceServer[] | undefined;
  /** Changes whenever a join is started or cancelled, so a slow ICE lookup can tell it's out of date. */
  private attempt = 0;
  private starting = false;

  constructor(private readonly deps: MeshDeps) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = (): MeshSnapshot => this.snapshot;

  join(roomId: string, localStream: MediaStream, media: MediaState): void {
    if (this.transport || this.starting) return;
    this.localStream = localStream;
    this.media = media;
    this.set({ ...IDLE, status: "joining" });

    const load = this.deps.loadIceServers;
    if (!load) return this.start(roomId);

    const attempt = ++this.attempt;
    this.starting = true;
    load()
      .catch(() => undefined) // joining matters more than TURN: carry on with defaults
      .then((servers) => {
        if (attempt !== this.attempt) return; // left again while we were waiting
        this.starting = false;
        this.iceServers = servers;
        this.start(roomId);
      });
  }

  private start(roomId: string): void {
    this.transport = this.deps.createTransport({
      onJoined: (self, existing) => {
        if (this.transport) this.deps.board?.attach(this.transport, self.id);
        this.deps.files?.attach(roomId);
        this.set({ status: "joined", roomId });
        existing.forEach((p) => this.connectPeer(p, true));
        this.transport?.sendMedia(this.media);
      },
      onPeerJoined: (peer) => this.connectPeer(peer, false),
      onPeerLeft: (id) => this.removePeer(id),
      onPeerMedia: (id, m) => this.patchPeer(id, m),
      onPeerShare: (id, share) => this.onPeerShare(id, share),
      onShareRejected: (message) => {
        this.stopShare();
        this.set({ notice: message });
      },
      onBoardSync: (strokes) => this.deps.board?.applySync(strokes),
      onBoardDraw: (draw) => this.deps.board?.applyDraw(draw),
      onBoardAdd: (stroke) => this.deps.board?.applyAdd(stroke),
      onBoardRemove: (id, by) => this.deps.board?.applyRemove(id, by),
      onBoardCleared: () => this.deps.board?.applyCleared(),
      onBoardRejected: (message) => this.set({ notice: message }),
      onFilesSync: (files) => this.deps.files?.applySync(files),
      onFileAdded: (file) => this.deps.files?.applyAdded(file),
      onFileRemoved: (fileId) => this.deps.files?.applyRemoved(fileId),
      onError: (message) => this.fail(message),
      onDisconnect: () => this.fail("The connection to the call server was lost. Join again to continue."),
    });
    this.transport.join({ roomId });
  }

  /** Call whenever the local mic or camera is toggled. */
  setMedia(media: MediaState): void {
    this.media = media;
    if (this.snapshot.status === "joined") this.transport?.sendMedia(media);
  }

  /** Begin presenting a captured screen. Takes ownership of the stream. */
  startShare(stream: MediaStream): void {
    const someoneElseIsPresenting = [...this.entries.values()].some((e) => e.screenStreamId !== null);
    if (this.snapshot.status !== "joined" || this.localScreen || someoneElseIsPresenting) {
      stream.getTracks().forEach((t) => t.stop());
      if (someoneElseIsPresenting) this.set({ notice: "Someone else is already sharing their screen." });
      return;
    }
    this.localScreen = stream;
    // The browser's own "Stop sharing" button ends the track without going through us.
    stream.getVideoTracks()[0]?.addEventListener("ended", this.stopShare);
    this.entries.forEach((e) => e.handle.addScreenStream(stream));
    this.transport?.sendShare({ streamId: stream.id });
    this.set({ localScreen: stream, notice: null });
    this.applyBitrate();
  }

  readonly stopShare = (): void => {
    const stream = this.localScreen;
    if (!stream) return;
    this.localScreen = null;
    stream.getVideoTracks()[0]?.removeEventListener("ended", this.stopShare);
    stream.getTracks().forEach((t) => t.stop());
    this.entries.forEach((e) => e.handle.removeScreenStream());
    this.transport?.sendShare({ streamId: null });
    this.set({ localScreen: null });
    this.applyBitrate();
  };

  notify(message: string): void {
    this.set({ notice: message });
  }

  readonly clearNotice = (): void => {
    if (this.snapshot.notice) this.set({ notice: null });
  };

  readonly leave = (): void => {
    if (this.starting) {
      this.attempt++; // cancels the pending join
      this.starting = false;
      this.teardown(null);
    } else if (this.transport) {
      this.teardown(null);
    }
  };

  private connectPeer(peer: Participant, initiator: boolean): void {
    if (!this.transport || this.entries.has(peer.id)) return;

    const handle = this.deps.createPeer(
      this.transport.channelFor(peer.id),
      {
        onRemoteStream: (stream) => this.addRemoteStream(peer.id, stream),
        onStateChange: (state) => this.onPeerState(peer.id, state),
        onError: () => this.patchPeer(peer.id, { state: "failed" }),
      },
      { polite: !initiator, iceServers: this.iceServers },
    );
    this.entries.set(peer.id, { handle, initiator, restarts: 0, streams: [], screenStreamId: peer.share.streamId });
    if (this.localStream) handle.addLocalStream(this.localStream);
    if (this.localScreen) handle.addScreenStream(this.localScreen);

    this.set({
      peers: [
        ...this.snapshot.peers,
        {
          id: peer.id,
          displayName: peer.displayName,
          stream: null,
          screenStream: null,
          state: "new",
          micOn: peer.media.micOn,
          camOn: peer.media.camOn,
        },
      ],
    });
    if (initiator) handle.call().catch(() => this.patchPeer(peer.id, { state: "failed" }));
    this.applyBitrate();
  }

  private addRemoteStream(id: string, stream: MediaStream): void {
    const entry = this.entries.get(id);
    if (!entry || entry.streams.some((s) => s.id === stream.id)) return;
    entry.streams.push(stream);
    this.syncStreams(id);
  }

  private onPeerShare(id: string, share: ShareState): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const previous = entry.screenStreamId;
    entry.screenStreamId = share.streamId;
    // A finished screen must not be mistaken for the camera afterwards.
    if (previous && previous !== share.streamId) entry.streams = entry.streams.filter((s) => s.id !== previous);
    this.syncStreams(id);
  }

  /** Tracks can arrive before or after the announcement saying which stream is the screen. */
  private syncStreams(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    const screen = entry.screenStreamId ? (entry.streams.find((s) => s.id === entry.screenStreamId) ?? null) : null;
    const camera = entry.streams.find((s) => s.id !== entry.screenStreamId) ?? null;
    this.patchPeer(id, { stream: camera, screenStream: screen });
  }

  private onPeerState(id: string, state: RTCPeerConnectionState): void {
    this.patchPeer(id, { state });
    const entry = this.entries.get(id);
    if (!entry) return;

    if (state === "connected") {
      entry.restarts = 0;
      this.applyBitrate();
    } else if (state === "failed" && entry.initiator && entry.restarts < MAX_ICE_RESTARTS) {
      entry.restarts++;
      entry.handle.restartIce().catch(() => {});
    }
  }

  private removePeer(id: string): void {
    this.entries.get(id)?.handle.close();
    this.entries.delete(id);
    this.set({ peers: this.snapshot.peers.filter((p) => p.id !== id) });
    this.applyBitrate();
  }

  /** Handles remember the caps and apply them once the connection is ready. */
  private applyBitrate(): void {
    const others = this.entries.size;
    const cameraCap = videoBitrateFor(others);
    const camera = this.localScreen ? Math.min(cameraCap ?? SHARER_CAMERA_BITRATE, SHARER_CAMERA_BITRATE) : cameraCap;
    for (const entry of this.entries.values()) {
      entry.handle.setMaxVideoBitrate(camera).catch(() => {});
      if (this.localScreen) entry.handle.setScreenBitrate(screenBitrateFor(others)).catch(() => {});
    }
  }

  private patchPeer(id: string, patch: Partial<RemotePeer>): void {
    this.set({ peers: this.snapshot.peers.map((p) => (p.id === id ? { ...p, ...patch } : p)) });
  }

  private fail(message: string): void {
    if (this.transport) this.teardown(message);
  }

  private teardown(error: string | null): void {
    this.localScreen?.getTracks().forEach((t) => t.stop());
    this.localScreen = null;
    this.entries.forEach((e) => e.handle.close());
    this.entries.clear();
    this.transport?.dispose();
    this.transport = null;
    this.deps.board?.detach();
    this.deps.files?.detach();
    this.localStream = null;
    this.set({ ...IDLE, error });
  }

  private set(patch: Partial<MeshSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((l) => l());
  }
}
