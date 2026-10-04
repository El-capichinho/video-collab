import { randomUUID } from "node:crypto";
import { io as connect, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClientToServerEvents, ServerToClientEvents } from "@vc/shared";
import { startTestServer } from "./testing/startTestServer";

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;
type TestServer = Awaited<ReturnType<typeof startTestServer>>;

const open: Client[] = [];
afterAll(() => open.forEach((c) => c.disconnect()));

async function client(srv: TestServer, displayName: string): Promise<Client> {
  const { token } = await srv.tokens.signAccess({ id: randomUUID(), displayName });
  const c: Client = connect(srv.url, { transports: ["websocket"], forceNew: true, auth: { token } });
  open.push(c);
  await new Promise<void>((resolve, reject) => {
    c.on("connect", () => resolve());
    c.on("connect_error", reject);
  });
  return c;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const next = (c: Client, event: string): Promise<any> => new Promise((res) => (c as any).once(event, res));
const quiet = (ms = 200) => new Promise((r) => setTimeout(r, ms));

async function join(c: Client, roomId: string) {
  const joined = next(c, "room:joined");
  c.emit("room:join", { roomId });
  return joined;
}

const ON = { micOn: true, camOn: true };
const NO_SHARE = { streamId: null };

describe("signaling server", () => {
  let srv: TestServer; // rooms capped at 2
  beforeAll(async () => {
    srv = await startTestServer();
  });
  afterAll(() => srv.close());

  it("tells the newcomer who is there, and tells others about the newcomer", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    const first = await join(a, "room-one");
    expect(first.peers).toEqual([]);

    const aSeesB = next(a, "room:peer-joined");
    const second = await join(b, "room-one");
    expect(second.peers).toEqual([{ id: a.id, displayName: "Ama", media: ON, share: NO_SHARE }]);
    expect(await aSeesB).toEqual({ id: b.id, displayName: "Kofi", media: ON, share: NO_SHARE });
  });

  it("uses the account's name, ignoring any name the client tries to send", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "room-names");
    const aSeesB = next(a, "room:peer-joined");
    (b as Socket).emit("room:join", { roomId: "room-names", displayName: "The Admin" });
    expect(await aSeesB).toEqual({ id: b.id, displayName: "Kofi", media: ON, share: NO_SHARE });
  });

  it("relays signals to a peer in the same room, stamped with the sender", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "room-two");
    await join(b, "room-two");

    const received = next(a, "signal");
    b.emit("signal", { kind: "ice", to: a.id as string, candidate: { candidate: "x" } });
    expect(await received).toMatchObject({ from: b.id, kind: "ice", candidate: { candidate: "x" } });
  });

  it("never relays across rooms", async () => {
    const a = await client(srv, "Ama");
    const c = await client(srv, "Esi");
    await join(a, "room-three-a");
    await join(c, "room-three-b");

    let leaked = false;
    a.on("signal", () => (leaked = true));
    c.emit("signal", { kind: "ice", to: a.id as string, candidate: { candidate: "x" } });
    await quiet();
    expect(leaked).toBe(false);
  });

  it("rejects invalid room names with a readable message", async () => {
    const a = await client(srv, "Ama");
    const err = next(a, "room:error");
    a.emit("room:join", { roomId: "!!" });
    expect(await err).toMatchObject({ code: "invalid_payload" });
  });

  it("enforces the room size limit", async () => {
    const a = await client(srv, "A");
    const b = await client(srv, "B");
    const c = await client(srv, "C");
    await join(a, "room-five");
    await join(b, "room-five");
    const err = next(c, "room:error");
    c.emit("room:join", { roomId: "room-five" });
    expect(await err).toMatchObject({ code: "room_full" });
  });

  it("announces when a peer disconnects", async () => {
    const a = await client(srv, "A");
    const b = await client(srv, "B");
    await join(a, "room-six");
    await join(b, "room-six");
    const bId = b.id;
    const left = next(a, "room:peer-left");
    b.disconnect();
    expect(await left).toBe(bId);
  });
});

describe("multi-person rooms", () => {
  let srv: TestServer; // rooms capped at 6
  beforeAll(async () => {
    srv = await startTestServer({ maxRoomSize: 6 });
  });
  afterAll(() => srv.close());

  it("shows a newcomer everyone already there, and tells everyone about the newcomer", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    const c = await client(srv, "Esi");
    await join(a, "mesh-one");
    const aSeesB = next(a, "room:peer-joined");
    await join(b, "mesh-one");
    await aSeesB; // settle Kofi's arrival first, so the next event we catch is Esi's

    const aSees = next(a, "room:peer-joined");
    const bSees = next(b, "room:peer-joined");
    const joined = await join(c, "mesh-one");

    expect(joined.peers.map((p: { id: string }) => p.id)).toEqual([a.id, b.id]);
    expect((await aSees).id).toBe(c.id);
    expect((await bSees).id).toBe(c.id);
  });

  it("delivers a signal only to its target, not to the rest of the room", async () => {
    const [a, b, c] = [await client(srv, "A"), await client(srv, "B"), await client(srv, "C")];
    for (const p of [a, b, c]) await join(p, "mesh-two");

    let bHeard = false;
    b.on("signal", () => (bHeard = true));
    const aHears = next(a, "signal");
    c.emit("signal", { kind: "ice", to: a.id as string, candidate: { candidate: "x" } });

    expect(await aHears).toMatchObject({ from: c.id });
    await quiet();
    expect(bHeard).toBe(false);
  });

  it("relays mute and camera changes, and tells late joiners the current state", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "mesh-three");
    await join(b, "mesh-three");

    const aHears = next(a, "room:peer-media");
    b.emit("media:state", { micOn: false, camOn: true });
    expect(await aHears).toEqual({ peerId: b.id, micOn: false, camOn: true });

    const c = await client(srv, "Esi");
    const joined = await join(c, "mesh-three");
    const seenB = joined.peers.find((p: { id: string }) => p.id === b.id);
    expect(seenB.media).toEqual({ micOn: false, camOn: true });
  });

  it("ignores malformed media state", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "mesh-four");
    await join(b, "mesh-four");

    let heard = false;
    a.on("room:peer-media", () => (heard = true));
    (b as Socket).emit("media:state", { micOn: "yes", camOn: 1 });
    await quiet();
    expect(heard).toBe(false);
  });

  it("tells everyone left when someone disconnects", async () => {
    const [a, b, c] = [await client(srv, "A"), await client(srv, "B"), await client(srv, "C")];
    for (const p of [a, b, c]) await join(p, "mesh-five");

    const bId = b.id;
    const aHears = next(a, "room:peer-left");
    const cHears = next(c, "room:peer-left");
    b.disconnect();
    expect(await aHears).toBe(bId);
    expect(await cHears).toBe(bId);
  });

  it("announces screen sharing to others, and tells late joiners who is presenting", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "share-one");
    await join(b, "share-one");

    const bHears = next(b, "room:peer-share");
    a.emit("share:state", { streamId: "screen-1" });
    expect(await bHears).toEqual({ peerId: a.id, streamId: "screen-1" });

    const c = await client(srv, "Esi");
    const joined = await join(c, "share-one");
    expect(joined.peers.find((p: { id: string }) => p.id === a.id).share).toEqual({ streamId: "screen-1" });
  });

  it("allows only one presenter at a time, and frees the slot when they stop", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "share-two");
    await join(b, "share-two");

    const aHears = next(a, "room:peer-share");
    a.emit("share:state", { streamId: "screen-a" });
    await next(b, "room:peer-share");

    const rejected = next(b, "share:rejected");
    b.emit("share:state", { streamId: "screen-b" });
    expect((await rejected).message).toMatch(/already sharing/);
    void aHears;

    const stopped = next(b, "room:peer-share");
    a.emit("share:state", { streamId: null });
    expect(await stopped).toEqual({ peerId: a.id, streamId: null });

    const taken = next(a, "room:peer-share");
    b.emit("share:state", { streamId: "screen-b" });
    expect(await taken).toEqual({ peerId: b.id, streamId: "screen-b" });
  });

  it("frees the presenter slot when the presenter disconnects", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "share-three");
    await join(b, "share-three");
    const seen = next(b, "room:peer-share");
    a.emit("share:state", { streamId: "screen-a" });
    await seen;

    const left = next(b, "room:peer-left");
    a.disconnect();
    await left;

    const c = await client(srv, "Esi");
    const joined = await join(c, "share-three");
    expect(joined.peers.map((p: { share: unknown }) => p.share)).toEqual([NO_SHARE]);
    const rejected = vi.fn();
    b.on("share:rejected", rejected);
    b.emit("share:state", { streamId: "screen-b" });
    await quiet();
    expect(rejected).not.toHaveBeenCalled();
  });

  it("ignores malformed share state", async () => {
    const a = await client(srv, "Ama");
    const b = await client(srv, "Kofi");
    await join(a, "share-four");
    await join(b, "share-four");

    let heard = false;
    b.on("room:peer-share", () => (heard = true));
    (a as Socket).emit("share:state", { streamId: 42 });
    await quiet();
    expect(heard).toBe(false);
  });
});

describe("whiteboard", () => {
  let srv: TestServer;
  beforeAll(async () => {
    srv = await startTestServer({ maxRoomSize: 6, boardLimits: { maxStrokes: 2 } });
  });
  afterAll(() => srv.close());

  const inRoom = async (roomId: string, ...names: string[]) => {
    const people: Client[] = [];
    for (const name of names) {
      const c = await client(srv, name);
      await join(c, roomId);
      people.push(c);
    }
    return people;
  };

  const stroke = (strokeId: string, points: number[], end = false) => ({
    strokeId,
    tool: "pen" as const,
    color: "#0a84ff",
    width: 5,
    points,
    end,
  });

  /** What a person joining right now would be shown. */
  async function boardSeenBy(roomId: string) {
    const c = await client(srv, "Observer");
    const sync = next(c, "board:sync");
    c.emit("room:join", { roomId });
    const { strokes } = await sync;
    c.disconnect();
    return strokes as Array<{ id: string; ownerId: string; points: number[] }>;
  }

  it("relays drawing to everyone else, stamped with who drew it, but not back to the drawer", async () => {
    const [a, b] = await inRoom("board-one", "Ama", "Kofi");
    let echoed = false;
    a!.on("board:draw", () => (echoed = true));

    const heard = next(b!, "board:draw");
    a!.emit("board:draw", stroke("s1", [0.1, 0.2, 0.3, 0.4]));
    expect(await heard).toMatchObject({ ownerId: a!.id, strokeId: "s1", points: [0.1, 0.2, 0.3, 0.4], end: false });
    await quiet();
    expect(echoed).toBe(false);
  });

  it("shows a late joiner everything drawn so far, including strokes still in progress", async () => {
    const [a] = await inRoom("board-two", "Ama");
    a!.emit("board:draw", stroke("s1", [0.1, 0.1]));
    a!.emit("board:draw", stroke("s1", [0.2, 0.2], true));
    a!.emit("board:draw", stroke("s2", [0.5, 0.5]));
    await quiet();

    const seen = await boardSeenBy("board-two");
    expect(seen.map((s) => [s.id, s.points])).toEqual([
      ["s1", [0.1, 0.1, 0.2, 0.2]],
      ["s2", [0.5, 0.5]],
    ]);
  });

  it("undo takes back only your own last stroke, for everyone", async () => {
    const [a, b] = await inRoom("board-three", "Ama", "Kofi");
    a!.emit("board:draw", stroke("a1", [0.1, 0.1], true));
    b!.emit("board:draw", stroke("b1", [0.2, 0.2], true));
    await quiet();

    const aHears = next(a!, "board:remove");
    const bHears = next(b!, "board:remove");
    a!.emit("board:undo");
    expect(await aHears).toEqual({ strokeId: "a1", by: a!.id });
    expect(await bHears).toEqual({ strokeId: "a1", by: a!.id });

    expect((await boardSeenBy("board-three")).map((s) => s.id)).toEqual(["b1"]);
  });

  it("redo puts the stroke back for everyone, and does nothing if there is nothing to redo", async () => {
    const [a, b] = await inRoom("board-four", "Ama", "Kofi");
    a!.emit("board:draw", stroke("a1", [0.1, 0.1], true));
    await quiet();
    a!.emit("board:undo");
    await next(b!, "board:remove");

    const added = next(b!, "board:add");
    a!.emit("board:redo");
    expect((await added).stroke).toMatchObject({ id: "a1", ownerId: a!.id, points: [0.1, 0.1] });

    let extra = false;
    b!.on("board:add", () => (extra = true));
    a!.emit("board:redo");
    await quiet();
    expect(extra).toBe(false);
  });

  it("clear empties the board for everyone, including people who join afterwards", async () => {
    const [a, b] = await inRoom("board-five", "Ama", "Kofi");
    a!.emit("board:draw", stroke("a1", [0.1, 0.1], true));
    b!.emit("board:draw", stroke("b1", [0.2, 0.2], true));
    await quiet();

    const aHears = next(a!, "board:cleared");
    const bHears = next(b!, "board:cleared");
    b!.emit("board:clear");
    await aHears;
    await bHears;
    expect(await boardSeenBy("board-five")).toEqual([]);
  });

  it("won't let one person add to another's stroke", async () => {
    const [a, b] = await inRoom("board-six", "Ama", "Kofi");
    a!.emit("board:draw", stroke("a1", [0.1, 0.1]));
    await quiet();
    b!.emit("board:draw", stroke("a1", [0.9, 0.9]));
    await quiet();
    expect((await boardSeenBy("board-six"))[0]?.points).toEqual([0.1, 0.1]);
  });

  it("ignores malformed drawing", async () => {
    const [a, b] = await inRoom("board-seven", "Ama", "Kofi");
    let heard = false;
    b!.on("board:draw", () => (heard = true));

    const bad = [
      { ...stroke("x", [0.1, 0.1]), points: [1.5, 0.1] }, // outside the board
      { ...stroke("x", [0.1, 0.1]), points: [0.1] }, // not a pair
      { ...stroke("x", [0.1, 0.1]), color: "red" },
      { ...stroke("x", [0.1, 0.1]), width: 9999 },
      { strokeId: "x" },
    ];
    for (const payload of bad) (a as Socket).emit("board:draw", payload);
    await quiet();
    expect(heard).toBe(false);
    expect(await boardSeenBy("board-seven")).toEqual([]);
  });

  it("ignores drawing from someone who is not in a room", async () => {
    const outsider = await client(srv, "Outsider");
    const [b] = await inRoom("board-eight", "Kofi");
    let heard = false;
    b!.on("board:draw", () => (heard = true));
    outsider.emit("board:draw", stroke("s1", [0.1, 0.1]));
    await quiet();
    expect(heard).toBe(false);
  });

  it("keeps a drawing after the person who made it leaves, and forgets the board when the room empties", async () => {
    const [a, b] = await inRoom("board-nine", "Ama", "Kofi");
    a!.emit("board:draw", stroke("a1", [0.1, 0.1]));
    await quiet();

    const left = next(b!, "room:peer-left");
    a!.disconnect();
    await left;
    expect((await boardSeenBy("board-nine")).map((s) => s.id)).toEqual(["a1"]);

    b!.disconnect();
    await quiet();
    expect(await boardSeenBy("board-nine")).toEqual([]);
  });

  it("tells the drawer when the board is full", async () => {
    const [a] = await inRoom("board-ten", "Ama");
    a!.emit("board:draw", stroke("s1", [0.1, 0.1], true));
    a!.emit("board:draw", stroke("s2", [0.2, 0.2], true));
    const rejected = next(a!, "board:rejected");
    a!.emit("board:draw", stroke("s3", [0.3, 0.3], true));
    expect((await rejected).message).toMatch(/full/);
  });
});
