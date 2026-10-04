import { describe, expect, it } from "vitest";
import type { MediaState, Participant, ShareState } from "@vc/shared";
import type { PeerEvents } from "../rtc/PeerConnectionManager";
import type { SignalingChannel } from "../rtc/signaling";
import { MeshCoordinator, screenBitrateFor, videoBitrateFor, type MeshDeps, type PeerHandle, type RoomTransport } from "./MeshCoordinator";
import type { RoomEvents } from "./RoomClient";

const ON: MediaState = { micOn: true, camOn: true };
const NO_SHARE: ShareState = { streamId: null };
const who = (id: string, media: MediaState = ON, share: ShareState = NO_SHARE): Participant => ({
  id,
  displayName: id.toUpperCase(),
  media,
  share,
});

/** A stand-in MediaStream whose single video track can be "ended" like the browser's Stop sharing button. */
function fakeStream(id: string) {
  const listeners = new Map<string, Array<() => void>>();
  const track = {
    kind: "video",
    stopped: false,
    stop() { this.stopped = true; },
    addEventListener: (type: string, fn: () => void) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    removeEventListener: (type: string, fn: () => void) => listeners.set(type, (listeners.get(type) ?? []).filter((f) => f !== fn)),
    end() { (listeners.get("ended") ?? []).forEach((fn) => fn()); },
  };
  const stream = { id, getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

class FakePeer implements PeerHandle {
  calls: string[] = [];
  bitrates: Array<number | null> = [];
  screenBitrates: Array<number | null> = [];
  screens: MediaStream[] = [];
  constructor(readonly id: string, readonly events: PeerEvents, readonly polite: boolean, readonly iceServers?: RTCIceServer[]) {}
  addScreenStream(stream: MediaStream) { this.calls.push("addScreen"); this.screens.push(stream); }
  removeScreenStream() { this.calls.push("removeScreen"); }
  async setScreenBitrate(b: number | null) { this.screenBitrates.push(b); }
  addLocalStream() { this.calls.push("addLocalStream"); }
  async call() { this.calls.push("call"); }
  async restartIce() { this.calls.push("restartIce"); }
  async setMaxVideoBitrate(b: number | null) { this.bitrates.push(b); }
  close() { this.calls.push("close"); }
}

class FakeTransport implements RoomTransport {
  joined: unknown = null;
  sent: MediaState[] = [];
  shares: ShareState[] = [];
  disposed = false;
  constructor(readonly events: RoomEvents) {}
  join(payload: unknown) { this.joined = payload; }
  channelFor(peerId: string) { return { peerId, send() {}, onMessage: () => () => {} } as unknown as SignalingChannel; }
  sendMedia(state: MediaState) { this.sent.push(state); }
  sendBoardDraw() {}
  sendBoardUndo() {}
  sendBoardRedo() {}
  sendBoardClear() {}
  sendShare(state: ShareState) { this.shares.push(state); }
  dispose() { this.disposed = true; }
}

class FakeBoard {
  log: string[] = [];
  attachedTo: unknown = null;
  selfId: string | null = null;
  attach(sender: unknown, selfId: string) { this.attachedTo = sender; this.selfId = selfId; this.log.push("attach"); }
  detach() { this.attachedTo = null; this.log.push("detach"); }
  applySync(strokes: unknown[]) { this.log.push(`sync:${strokes.length}`); }
  applyDraw(d: { strokeId: string }) { this.log.push(`draw:${d.strokeId}`); }
  applyAdd(s: { id: string }) { this.log.push(`add:${s.id}`); }
  applyRemove(id: string, by: string) { this.log.push(`remove:${id}:${by}`); }
  applyCleared() { this.log.push("cleared"); }
}

class FakeFiles {
  log: string[] = [];
  attach(roomId: string) { this.log.push(`attach:${roomId}`); }
  detach() { this.log.push("detach"); }
  applySync(files: unknown[]) { this.log.push(`sync:${files.length}`); }
  applyAdded(f: { id: string }) { this.log.push(`added:${f.id}`); }
  applyRemoved(id: string) { this.log.push(`removed:${id}`); }
}

function setup(extra: Partial<MeshDeps> = {}) {
  const peers = new Map<string, FakePeer>();
  let transport!: FakeTransport;
  let transportsCreated = 0;
  const board = new FakeBoard();
  const files = new FakeFiles();
  const mesh = new MeshCoordinator({
    board,
    files,
    createTransport: (events) => ((transportsCreated++), (transport = new FakeTransport(events))),
    createPeer: (channel, events, options) => {
      const id = (channel as unknown as { peerId: string }).peerId;
      const peer = new FakePeer(id, events, options.polite, options.iceServers);
      peers.set(id, peer);
      return peer;
    },
    ...extra,
  });
  const stream = {} as MediaStream;
  return { mesh, peers, board, files, transport: () => transport, transportsCreated: () => transportsCreated, stream };
}

function joined(existing: Participant[] = []) {
  const s = setup();
  s.mesh.join("room-1", s.stream, ON);
  s.transport().events.onJoined?.(who("me"), existing);
  return s;
}

describe("MeshCoordinator", () => {
  it("asks the server to join, then reports joined", () => {
    const s = setup();
    s.mesh.join("room-1", s.stream, ON);
    expect(s.transport().joined).toEqual({ roomId: "room-1" });
    expect(s.mesh.getSnapshot().status).toBe("joining");

    s.transport().events.onJoined?.(who("me"), []);
    expect(s.mesh.getSnapshot()).toMatchObject({ status: "joined", roomId: "room-1" });
  });

  it("as the newcomer, calls everyone already in the room", () => {
    const { peers } = joined([who("a"), who("b"), who("c")]);
    expect([...peers.keys()]).toEqual(["a", "b", "c"]);
    for (const peer of peers.values()) expect(peer.calls).toEqual(["addLocalStream", "call"]);
  });

  it("as someone already there, waits to be called by a newcomer", () => {
    const s = joined([who("a")]);
    s.transport().events.onPeerJoined?.(who("d"));
    expect(s.peers.get("d")?.calls).toEqual(["addLocalStream"]);
    expect(s.mesh.getSnapshot().peers.map((p) => p.id)).toEqual(["a", "d"]);
  });

  it("starts each peer with the mic and camera state the server reported", () => {
    const s = joined([who("a", { micOn: false, camOn: true })]);
    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ micOn: false, camOn: true });
  });

  it("updates a peer when they mute or turn their camera off", () => {
    const s = joined([who("a")]);
    s.transport().events.onPeerMedia?.("a", { micOn: false, camOn: false });
    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ micOn: false, camOn: false });
  });

  it("removes and closes a peer who leaves", () => {
    const s = joined([who("a"), who("b")]);
    s.transport().events.onPeerLeft?.("a");
    expect(s.peers.get("a")?.calls).toContain("close");
    expect(s.mesh.getSnapshot().peers.map((p) => p.id)).toEqual(["b"]);
  });

  it("ignores a duplicate announcement for a peer it already has", () => {
    const s = joined([who("a")]);
    s.transport().events.onPeerJoined?.(who("a"));
    expect(s.mesh.getSnapshot().peers).toHaveLength(1);
  });

  it("shares its own media state on joining and whenever it changes", () => {
    const s = joined();
    expect(s.transport().sent).toEqual([ON]);
    s.mesh.setMedia({ micOn: false, camOn: true });
    expect(s.transport().sent.at(-1)).toEqual({ micOn: false, camOn: true });
  });

  it("restarts ICE after a failure, but only if it made the offer, and only a few times", () => {
    const s = joined([who("a")]); // we called "a"
    s.transport().events.onPeerJoined?.(who("d")); // "d" called us
    const a = s.peers.get("a")!;
    const d = s.peers.get("d")!;

    for (let i = 0; i < 5; i++) a.events.onStateChange?.("failed");
    d.events.onStateChange?.("failed");

    expect(a.calls.filter((c) => c === "restartIce")).toHaveLength(3);
    expect(d.calls).not.toContain("restartIce");
  });

  it("resets the restart allowance once a peer reconnects", () => {
    const s = joined([who("a")]);
    const a = s.peers.get("a")!;
    for (let i = 0; i < 3; i++) a.events.onStateChange?.("failed");
    a.events.onStateChange?.("connected");
    a.events.onStateChange?.("failed");
    expect(a.calls.filter((c) => c === "restartIce")).toHaveLength(4);
  });

  it("lowers video bitrate as the room grows", () => {
    const s = joined([who("a"), who("b"), who("c")]);
    for (const p of s.peers.values()) p.events.onStateChange?.("connected");
    expect(s.peers.get("a")?.bitrates.at(-1)).toBe(500_000);

    s.transport().events.onPeerLeft?.("c");
    expect(s.peers.get("a")?.bitrates.at(-1)).toBe(1_000_000);
  });

  it("on a server error, tears everything down and reports why", () => {
    const s = joined([who("a")]);
    s.transport().events.onError?.("This room is full (up to 6 people).");
    expect(s.peers.get("a")?.calls).toContain("close");
    expect(s.transport().disposed).toBe(true);
    expect(s.mesh.getSnapshot()).toMatchObject({
      status: "idle",
      peers: [],
      error: "This room is full (up to 6 people).",
    });
  });

  it("leaving clears the room and any earlier error", () => {
    const s = joined([who("a")]);
    s.mesh.leave();
    expect(s.mesh.getSnapshot()).toMatchObject({ status: "idle", peers: [], error: null });
  });
});

describe("MeshCoordinator: negotiation roles", () => {
  it("is impolite toward people it calls, and polite toward people who call it", () => {
    const s = joined([who("a")]);
    s.transport().events.onPeerJoined?.(who("d"));
    expect(s.peers.get("a")?.polite).toBe(false);
    expect(s.peers.get("d")?.polite).toBe(true);
  });
});

describe("MeshCoordinator: presenting your screen", () => {
  it("sends the screen to everyone in the room and announces which stream it is", () => {
    const s = joined([who("a"), who("b")]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);

    expect(s.peers.get("a")?.screens).toEqual([screen.stream]);
    expect(s.peers.get("b")?.screens).toEqual([screen.stream]);
    expect(s.transport().shares).toEqual([{ streamId: "screen-1" }]);
    expect(s.mesh.getSnapshot().localScreen).toBe(screen.stream);
  });

  it("also sends the screen to people who join while it is being shared", () => {
    const s = joined([who("a")]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);
    s.transport().events.onPeerJoined?.(who("d"));
    expect(s.peers.get("d")?.screens).toEqual([screen.stream]);
  });

  it("stopping removes the screen, tells the room, and releases the capture", () => {
    const s = joined([who("a")]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);
    s.mesh.stopShare();

    expect(s.peers.get("a")?.calls).toContain("removeScreen");
    expect(s.transport().shares.at(-1)).toEqual({ streamId: null });
    expect(screen.track.stopped).toBe(true);
    expect(s.mesh.getSnapshot().localScreen).toBeNull();
  });

  it("stops when the browser's own Stop sharing button is used", () => {
    const s = joined([who("a")]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);
    screen.track.end();

    expect(s.mesh.getSnapshot().localScreen).toBeNull();
    expect(s.transport().shares.at(-1)).toEqual({ streamId: null });
  });

  it("refuses to present while someone else is, and says why", () => {
    const s = joined([who("a", ON, { streamId: "their-screen" })]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);

    expect(s.peers.get("a")?.screens).toEqual([]);
    expect(s.transport().shares).toEqual([]);
    expect(screen.track.stopped).toBe(true);
    expect(s.mesh.getSnapshot().notice).toMatch(/already sharing/);
  });

  it("gives up cleanly if the server says someone else got there first", () => {
    const s = joined([who("a")]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);
    s.transport().events.onShareRejected?.("Someone else is already sharing their screen.");

    expect(s.mesh.getSnapshot().localScreen).toBeNull();
    expect(screen.track.stopped).toBe(true);
    expect(s.mesh.getSnapshot().notice).toMatch(/already sharing/);
  });

  it("shrinks the camera to a thumbnail's bandwidth while presenting, then restores it", () => {
    const s = joined([who("a")]);
    s.mesh.startShare(fakeStream("screen-1").stream);
    expect(s.peers.get("a")?.bitrates.at(-1)).toBe(250_000);
    expect(s.peers.get("a")?.screenBitrates.at(-1)).toBe(screenBitrateFor(1));

    s.mesh.stopShare();
    expect(s.peers.get("a")?.bitrates.at(-1)).toBeNull();
  });

  it("ends the capture if the call is torn down", () => {
    const s = joined([who("a")]);
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);
    s.mesh.leave();
    expect(screen.track.stopped).toBe(true);
  });

  it("ignores a request to present when not in a room", () => {
    const s = setup();
    const screen = fakeStream("screen-1");
    s.mesh.startShare(screen.stream);
    expect(screen.track.stopped).toBe(true);
    expect(s.mesh.getSnapshot().localScreen).toBeNull();
  });
});

describe("MeshCoordinator: watching someone else present", () => {
  const camera = fakeStream("camera-a").stream;
  const screen = fakeStream("screen-a").stream;

  it("shows the screen separately from the camera when the announcement comes first", () => {
    const s = joined([who("a")]);
    const a = s.peers.get("a")!;
    a.events.onRemoteStream?.(camera);
    s.transport().events.onPeerShare?.("a", { streamId: "screen-a" });
    a.events.onRemoteStream?.(screen);

    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ stream: camera, screenStream: screen });
  });

  it("gets it right even if the screen arrives before the announcement", () => {
    const s = joined([who("a")]);
    const a = s.peers.get("a")!;
    a.events.onRemoteStream?.(camera);
    a.events.onRemoteStream?.(screen);
    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ stream: camera, screenStream: null });

    s.transport().events.onPeerShare?.("a", { streamId: "screen-a" });
    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ stream: camera, screenStream: screen });
  });

  it("clears the screen when they stop, leaving the camera untouched", () => {
    const s = joined([who("a")]);
    const a = s.peers.get("a")!;
    a.events.onRemoteStream?.(camera);
    s.transport().events.onPeerShare?.("a", { streamId: "screen-a" });
    a.events.onRemoteStream?.(screen);
    s.transport().events.onPeerShare?.("a", { streamId: null });

    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ stream: camera, screenStream: null });
  });

  it("knows about a presentation already under way when you join", () => {
    const s = joined([who("a", ON, { streamId: "screen-a" })]);
    const a = s.peers.get("a")!;
    a.events.onRemoteStream?.(camera);
    a.events.onRemoteStream?.(screen);
    expect(s.mesh.getSnapshot().peers[0]).toMatchObject({ stream: camera, screenStream: screen });
  });
});

describe("MeshCoordinator: whiteboard", () => {
  it("connects the board to the room once joined, using our own id", () => {
    const s = setup();
    s.mesh.join("room-1", s.stream, ON);
    expect(s.board.attachedTo).toBeNull();
    s.transport().events.onJoined?.(who("me"), []);
    expect(s.board.attachedTo).toBe(s.transport());
    expect(s.board.selfId).toBe("me");
  });

  it("passes the server's board updates to the board", () => {
    const s = joined();
    const e = s.transport().events;
    e.onBoardSync?.([]);
    e.onBoardDraw?.({ strokeId: "s1", ownerId: "a", tool: "pen", color: "#000000", width: 5, points: [], end: true });
    e.onBoardAdd?.({ id: "s2", ownerId: "a", tool: "pen", color: "#000000", width: 5, points: [] });
    e.onBoardRemove?.("s3", "a");
    e.onBoardCleared?.();
    expect(s.board.log).toEqual(["attach", "sync:0", "draw:s1", "add:s2", "remove:s3:a", "cleared"]);
  });

  it("shows the server's 'board is full' message as a notice", () => {
    const s = joined();
    s.transport().events.onBoardRejected?.("The whiteboard is full.");
    expect(s.mesh.getSnapshot().notice).toBe("The whiteboard is full.");
  });

  it("clears the board when the call ends", () => {
    const s = joined();
    s.mesh.leave();
    expect(s.board.log.at(-1)).toBe("detach");
  });
});

describe("MeshCoordinator: shared files", () => {
  it("tells the shelf which room it is in once joined, and passes updates along", () => {
    const s = joined();
    const e = s.transport().events;
    e.onFilesSync?.([]);
    e.onFileAdded?.({ id: "f1", name: "a.txt", size: 1, uploaderId: "u", uploaderName: "U", uploadedAt: 1 });
    e.onFileRemoved?.("f1");
    expect(s.files.log).toEqual(["attach:room-1", "sync:0", "added:f1", "removed:f1"]);
  });

  it("empties the shelf when the call ends", () => {
    const s = joined();
    s.mesh.leave();
    expect(s.files.log.at(-1)).toBe("detach");
  });
});

describe("MeshCoordinator: TURN credentials", () => {
  const TURN: RTCIceServer[] = [{ urls: ["turn:t.example.com:3478"], username: "1:u", credential: "c" }];
  const later = () => new Promise((r) => setTimeout(r, 0));

  it("fetches ICE servers first, then connects, and gives them to every peer", async () => {
    let finish!: (s: RTCIceServer[]) => void;
    const s = setup({ loadIceServers: () => new Promise((resolve) => (finish = resolve)) });

    s.mesh.join("room-1", s.stream, ON);
    expect(s.mesh.getSnapshot().status).toBe("joining");
    expect(s.transportsCreated()).toBe(0); // nothing connects until the servers are known

    finish(TURN);
    await later();
    expect(s.transportsCreated()).toBe(1);

    s.transport().events.onJoined?.(who("me"), [who("a")]);
    s.transport().events.onPeerJoined?.(who("d"));
    expect(s.peers.get("a")?.iceServers).toEqual(TURN);
    expect(s.peers.get("d")?.iceServers).toEqual(TURN);
  });

  it("cancels the join if the person leaves while the servers are loading", async () => {
    let finish!: (s: RTCIceServer[]) => void;
    const s = setup({ loadIceServers: () => new Promise((resolve) => (finish = resolve)) });

    s.mesh.join("room-1", s.stream, ON);
    s.mesh.leave();
    finish(TURN);
    await later();

    expect(s.transportsCreated()).toBe(0);
    expect(s.mesh.getSnapshot().status).toBe("idle");
  });

  it("joins anyway, with defaults, if loading the servers fails", async () => {
    const s = setup({ loadIceServers: () => Promise.reject(new Error("boom")) });
    s.mesh.join("room-1", s.stream, ON);
    await later();
    expect(s.transportsCreated()).toBe(1);

    s.transport().events.onJoined?.(who("me"), [who("a")]);
    expect(s.peers.get("a")?.iceServers).toBeUndefined();
  });

  it("ignores a second join while the first is still loading", async () => {
    let calls = 0;
    const s = setup({ loadIceServers: async () => (calls++, TURN) });
    s.mesh.join("room-1", s.stream, ON);
    s.mesh.join("room-1", s.stream, ON);
    await later();
    expect(calls).toBe(1);
    expect(s.transportsCreated()).toBe(1);
  });

  it("can join again after leaving mid-load", async () => {
    const resolvers: Array<(s: RTCIceServer[]) => void> = [];
    const s = setup({ loadIceServers: () => new Promise((resolve) => resolvers.push(resolve)) });

    s.mesh.join("room-1", s.stream, ON);
    s.mesh.leave();
    s.mesh.join("room-2", s.stream, ON);
    resolvers[0]!(TURN); // the abandoned attempt finishes late
    resolvers[1]!(TURN);
    await later();

    expect(s.transportsCreated()).toBe(1);
    expect(s.transport().joined).toEqual({ roomId: "room-2" });
  });
});

describe("videoBitrateFor", () => {
  it("keeps the default for small calls and steps down for bigger ones", () => {
    expect([1, 2, 3, 5].map(videoBitrateFor)).toEqual([null, 1_000_000, 500_000, 500_000]);
  });
});
