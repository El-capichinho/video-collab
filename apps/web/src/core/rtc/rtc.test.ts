import { describe, expect, it } from "vitest";
import { createLoopbackPair } from "./loopback";
import { PeerConnectionManager } from "./PeerConnectionManager";
import type { SignalHandler, SignalMessage, SignalingChannel } from "./signaling";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("loopback signaling", () => {
  it("delivers to the other side only, and can unsubscribe", async () => {
    const [a, b] = createLoopbackPair();
    const atA: SignalMessage[] = [];
    const atB: SignalMessage[] = [];
    a.onMessage((m) => atA.push(m));
    const off = b.onMessage((m) => atB.push(m));

    a.send({ kind: "ice", candidate: { candidate: "x" } });
    await tick();
    expect(atA).toHaveLength(0);
    expect(atB).toHaveLength(1);

    off();
    a.send({ kind: "ice", candidate: { candidate: "y" } });
    await tick();
    expect(atB).toHaveLength(1);
  });
});

describe("PeerConnectionManager", () => {
  it("holds early ICE candidates until the remote description is set", async () => {
    class FakePc {
      signalingState = "stable";
      remoteDescription: RTCSessionDescriptionInit | null = null;
      added: RTCIceCandidateInit[] = [];
      async setRemoteDescription(d: RTCSessionDescriptionInit) { this.remoteDescription = d; }
      async addIceCandidate(c: RTCIceCandidateInit) {
        if (!this.remoteDescription) throw new Error("no remote description");
        this.added.push(c);
      }
      async createAnswer() { return { type: "answer" as const, sdp: "a" }; }
      async setLocalDescription() {}
      addTrack() {}
      close() {}
    }
    const fake = new FakePc();
    let handler: SignalHandler = () => {};
    const sent: SignalMessage[] = [];
    const signaling: SignalingChannel = {
      send: (m) => sent.push(m),
      onMessage: (h) => ((handler = h), () => {}),
    };
    const errors: unknown[] = [];

    new PeerConnectionManager(signaling, { onError: (e) => errors.push(e) }, {
      createPeerConnection: () => fake as unknown as RTCPeerConnection,
    });

    handler({ kind: "ice", candidate: { candidate: "early" } });
    handler({ kind: "description", description: { type: "offer", sdp: "o" } });
    await tick();

    expect(errors).toHaveLength(0);
    expect(fake.added).toEqual([{ candidate: "early" }]);
    expect(sent.some((m) => m.kind === "description" && m.description.type === "answer")).toBe(true);
  });
});

describe("PeerConnectionManager: resilience", () => {
  function fakePc() {
    const offers: Array<RTCOfferOptions | undefined> = [];
    const video = { track: { kind: "video" }, encodings: [{} as RTCRtpEncodingParameters], sets: 0 };
    const audio = { track: { kind: "audio" }, sets: 0 };
    const sender = (s: { track: { kind: string }; encodings?: RTCRtpEncodingParameters[]; sets: number }) => ({
      track: s.track,
      getParameters: () => ({ encodings: s.encodings }),
      setParameters: async () => void s.sets++,
    });
    const pc = {
      signalingState: "stable",
      createOffer: async (o?: RTCOfferOptions) => (offers.push(o), { type: "offer" as const, sdp: "o" }),
      setLocalDescription: async () => {},
      getSenders: () => [sender(audio), sender(video)],
      close() {},
    };
    return { pc, offers, video, audio };
  }
  const silent: SignalingChannel = { send: () => {}, onMessage: () => () => {} };
  const manager = (pc: unknown) =>
    new PeerConnectionManager(silent, {}, { createPeerConnection: () => pc as RTCPeerConnection });

  it("restarts ICE only on the side that made the offer", async () => {
    const caller = fakePc();
    const callee = fakePc();
    const a = manager(caller.pc);
    const b = manager(callee.pc);

    await a.call();
    await a.restartIce();
    await b.restartIce();

    expect(caller.offers).toEqual([undefined, { iceRestart: true }]);
    expect(callee.offers).toEqual([]);
  });

  it("caps and uncaps the video sender's bitrate, leaving audio alone", async () => {
    const f = fakePc();
    const m = manager(f.pc);

    await m.setMaxVideoBitrate(500_000);
    expect(f.video.encodings[0]?.maxBitrate).toBe(500_000);
    expect(f.video.sets).toBe(1);
    expect(f.audio.sets).toBe(0);

    await m.setMaxVideoBitrate(null);
    expect(f.video.encodings[0]?.maxBitrate).toBeUndefined();
  });

  it("skips senders that have no encodings yet", async () => {
    const f = fakePc();
    f.video.encodings = [];
    await manager(f.pc).setMaxVideoBitrate(500_000);
    expect(f.video.sets).toBe(0);
  });
});

/** A fuller fake connection for the negotiation and screen-sharing tests. */
class RtcFake {
  signalingState = "stable";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  offers: Array<RTCOfferOptions | undefined> = [];
  remoteSet: RTCSessionDescriptionInit[] = [];
  answers = 0;
  senders: FakeSender[] = [];
  removed: FakeSender[] = [];
  onnegotiationneeded: (() => void) | null = null;
  ontrack: ((e: { streams: Array<{ id: string }> }) => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;

  async createOffer(o?: RTCOfferOptions) { this.offers.push(o); return { type: "offer" as const, sdp: "o" }; }
  async createAnswer() { this.answers++; return { type: "answer" as const, sdp: "a" }; }
  async setLocalDescription() {}
  async setRemoteDescription(d: RTCSessionDescriptionInit) { this.remoteSet.push(d); this.remoteDescription = d; }
  async addIceCandidate() {}
  addTrack(track: { kind: string }) { const s = new FakeSender(track); this.senders.push(s); return s; }
  removeTrack(s: FakeSender) { this.removed.push(s); s.track = null; }
  getSenders() { return this.senders; }
  close() {}
}
class FakeSender {
  encodings: RTCRtpEncodingParameters[] = [{}];
  sets = 0;
  constructor(public track: { kind: string } | null) {}
  getParameters() { return { encodings: this.encodings }; }
  async setParameters() { this.sets++; }
}

function rig(polite = false) {
  const fake = new RtcFake();
  const sent: SignalMessage[] = [];
  let deliver: SignalHandler = () => {};
  const signaling: SignalingChannel = {
    send: (m) => sent.push(m),
    onMessage: (h) => ((deliver = h), () => {}),
  };
  const streams: Array<{ id: string }> = [];
  const manager = new PeerConnectionManager(
    signaling,
    { onRemoteStream: (s) => streams.push(s) },
    { polite, createPeerConnection: () => fake as unknown as RTCPeerConnection },
  );
  const videoStream = (id: string) => ({
    id,
    getTracks: () => [{ kind: "video" }],
    getVideoTracks: () => [{ kind: "video" }],
  }) as unknown as MediaStream;
  return { fake, sent, deliver: (m: SignalMessage) => deliver(m), manager, streams, videoStream };
}

const offerMsg: SignalMessage = { kind: "description", description: { type: "offer", sdp: "o" } };
const answerMsg: SignalMessage = { kind: "description", description: { type: "answer", sdp: "a" } };

describe("PeerConnectionManager: perfect negotiation", () => {
  it("does not renegotiate on its own before the first exchange is done", async () => {
    const r = rig();
    r.fake.onnegotiationneeded?.();
    await tick();
    expect(r.fake.offers).toEqual([]);
  });

  it("renegotiates when a track is added after the call is established", async () => {
    const r = rig();
    await r.manager.call();
    r.deliver(answerMsg);
    await tick();
    r.fake.offers.length = 0;
    r.sent.length = 0;

    r.manager.addScreenStream(r.videoStream("screen-1"));
    r.fake.onnegotiationneeded?.();
    await tick();

    expect(r.fake.offers).toHaveLength(1);
    expect(r.sent.some((m) => m.kind === "description" && m.description.type === "offer")).toBe(true);
  });

  it("when both sides offer at once, the impolite side keeps its offer and ignores the other", async () => {
    const r = rig(false);
    r.fake.signalingState = "have-local-offer";
    r.deliver(offerMsg);
    await tick();
    expect(r.fake.remoteSet).toEqual([]);
    expect(r.fake.answers).toBe(0);
  });

  it("when both sides offer at once, the polite side accepts the other's offer", async () => {
    const r = rig(true);
    r.fake.signalingState = "have-local-offer";
    r.deliver(offerMsg);
    await tick();
    expect(r.fake.remoteSet).toEqual([{ type: "offer", sdp: "o" }]);
    expect(r.fake.answers).toBe(1);
  });

  it("reports each incoming stream once: camera first, then the screen", () => {
    const r = rig();
    r.fake.ontrack?.({ streams: [{ id: "camera" }] });
    r.fake.ontrack?.({ streams: [{ id: "camera" }] });
    r.fake.ontrack?.({ streams: [{ id: "screen" }] });
    expect(r.streams.map((s) => s.id)).toEqual(["camera", "screen"]);
  });
});

describe("PeerConnectionManager: screen sharing", () => {
  it("adds the screen as its own track, and removes it again", () => {
    const r = rig();
    r.manager.addScreenStream(r.videoStream("screen-1"));
    expect(r.fake.senders).toHaveLength(1);

    r.manager.removeScreenStream();
    expect(r.fake.removed).toHaveLength(1);
    r.manager.removeScreenStream(); // safe to repeat
    expect(r.fake.removed).toHaveLength(1);
  });

  it("caps the screen and the camera separately", async () => {
    const r = rig();
    r.manager.addLocalStream(r.videoStream("camera"));
    r.manager.addScreenStream(r.videoStream("screen-1"));
    const [camera, screen] = r.fake.senders as [FakeSender, FakeSender];

    await r.manager.setMaxVideoBitrate(250_000);
    await r.manager.setScreenBitrate(1_200_000);

    expect(camera.encodings[0]?.maxBitrate).toBe(250_000);
    expect(screen.encodings[0]?.maxBitrate).toBe(1_200_000);
  });

  it("applies a cap that was set before the sender was ready, once signaling settles", async () => {
    const r = rig();
    r.manager.addLocalStream(r.videoStream("camera"));
    const camera = r.fake.senders[0]!;
    camera.encodings = []; // not negotiated yet

    await r.manager.setMaxVideoBitrate(500_000);
    expect(camera.sets).toBe(0);

    camera.encodings = [{}];
    r.fake.onsignalingstatechange?.();
    await tick();
    expect(camera.encodings[0]?.maxBitrate).toBe(500_000);
  });
});
