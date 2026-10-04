import type { SignalMessage, SignalingChannel } from "./signaling";

export interface PeerEvents {
  /** Fires once per incoming stream: a peer's camera, and later their screen. */
  onRemoteStream?: (stream: MediaStream) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
  onError?: (error: unknown) => void;
}

export interface PeerOptions {
  config?: RTCConfiguration;
  /** Injected in tests; defaults to the browser's RTCPeerConnection. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  /**
   * If both sides make an offer at the same moment, the polite side backs down and
   * accepts the other's. One side of every pair must be polite, the other not.
   */
  polite?: boolean;
}

const DEFAULT_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

/**
 * Facade over RTCPeerConnection. Owns the offer/answer/ICE handshake so UI code
 * never touches the raw API. Uses the "perfect negotiation" pattern, so tracks
 * can be added or removed mid-call (screen sharing) without offers colliding.
 */
export class PeerConnectionManager {
  private readonly pc: RTCPeerConnection;
  private readonly unsubscribe: () => void;
  private readonly polite: boolean;
  private readonly seenStreams = new Set<string>();
  private pendingIce: RTCIceCandidateInit[] = [];
  private closed = false;
  private caller = false;
  private makingOffer = false;
  private ignoreOffer = false;
  /** True once the first offer/answer round has completed. */
  private negotiated = false;
  private screenSender: RTCRtpSender | null = null;
  private bitrates: { camera?: number | null; screen?: number | null } = {};

  constructor(
    private readonly signaling: SignalingChannel,
    private readonly events: PeerEvents = {},
    options: PeerOptions = {},
  ) {
    const create = options.createPeerConnection ?? ((c) => new RTCPeerConnection(c));
    this.pc = create(options.config ?? DEFAULT_CONFIG);
    this.polite = options.polite ?? false;

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.send({ kind: "ice", candidate: e.candidate.toJSON() });
    };
    this.pc.ontrack = (e) => {
      for (const stream of e.streams) {
        if (this.seenStreams.has(stream.id)) continue;
        this.seenStreams.add(stream.id);
        this.events.onRemoteStream?.(stream);
      }
    };
    this.pc.onconnectionstatechange = () => this.events.onStateChange?.(this.pc.connectionState);
    // The very first offer is made explicitly by call(); only later changes renegotiate here.
    this.pc.onnegotiationneeded = () => {
      if (!this.negotiated || this.closed) return;
      this.makeOffer().catch((error) => this.events.onError?.(error));
    };
    this.pc.onsignalingstatechange = () => {
      if (this.pc.signalingState === "stable") this.applyBitrates().catch(() => {});
    };

    this.unsubscribe = signaling.onMessage((message) => void this.handle(message));
  }

  addLocalStream(stream: MediaStream): void {
    stream.getTracks().forEach((track) => this.pc.addTrack(track, stream));
  }

  /** Start sending a screen. Triggers a renegotiation, which the other side answers. */
  addScreenStream(stream: MediaStream): void {
    const track = stream.getVideoTracks()[0];
    if (!track || this.closed) return;
    this.screenSender = this.pc.addTrack(track, stream);
  }

  removeScreenStream(): void {
    if (!this.screenSender) return;
    try {
      if (!this.closed) this.pc.removeTrack(this.screenSender);
    } catch {
      /* connection already closing */
    }
    this.screenSender = null;
  }

  /** Caller side: create an offer and send it. */
  async call(iceRestart = false): Promise<void> {
    this.caller = true;
    await this.makeOffer(iceRestart ? { iceRestart: true } : undefined);
  }

  /**
   * Try a fresh network path after a failure (Wi-Fi to mobile data, say). Only the
   * side that made the original offer restarts.
   */
  async restartIce(): Promise<void> {
    if (!this.caller || this.closed) return;
    await this.call(true);
  }

  /**
   * Cap what we send to this peer. In a mesh every extra participant multiplies
   * upload bandwidth, so caps drop as the room grows. null removes a cap. Caps
   * are remembered and applied as soon as the connection is ready for them.
   */
  async setMaxVideoBitrate(bitsPerSecond: number | null): Promise<void> {
    this.bitrates.camera = bitsPerSecond;
    await this.applyBitrates();
  }

  async setScreenBitrate(bitsPerSecond: number | null): Promise<void> {
    this.bitrates.screen = bitsPerSecond;
    await this.applyBitrates();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribe();
    this.pc.close();
  }

  private async makeOffer(options?: RTCOfferOptions): Promise<void> {
    try {
      this.makingOffer = true;
      const offer = await this.pc.createOffer(options);
      if (this.pc.signalingState !== "stable") return; // an incoming offer got there first
      await this.pc.setLocalDescription(offer);
      this.signaling.send({ kind: "description", description: offer });
    } finally {
      this.makingOffer = false;
    }
  }

  private async handle(message: SignalMessage): Promise<void> {
    if (this.closed) return;
    try {
      if (message.kind === "description") {
        const { description } = message;
        const collision =
          description.type === "offer" && (this.makingOffer || this.pc.signalingState !== "stable");
        this.ignoreOffer = !this.polite && collision;
        if (this.ignoreOffer) return; // the impolite side keeps its own offer

        await this.pc.setRemoteDescription(description); // the polite side rolls back implicitly
        await this.flushIce();
        if (description.type === "offer") {
          const answer = await this.pc.createAnswer();
          await this.pc.setLocalDescription(answer);
          this.signaling.send({ kind: "description", description: answer });
        }
        this.negotiated = true;
      } else if (this.pc.remoteDescription) {
        try {
          await this.pc.addIceCandidate(message.candidate);
        } catch (error) {
          if (!this.ignoreOffer) throw error; // candidates from an offer we ignored are expected to fail
        }
      } else {
        // ICE can arrive before the offer/answer; hold it until we can apply it.
        this.pendingIce.push(message.candidate);
      }
    } catch (error) {
      this.events.onError?.(error);
    }
  }

  private async flushIce(): Promise<void> {
    const queued = this.pendingIce;
    this.pendingIce = [];
    for (const candidate of queued) await this.pc.addIceCandidate(candidate);
  }

  private async applyBitrates(): Promise<void> {
    for (const sender of this.pc.getSenders()) {
      if (sender.track?.kind !== "video") continue;
      const wanted = sender === this.screenSender ? this.bitrates.screen : this.bitrates.camera;
      if (wanted === undefined) continue;

      const params = sender.getParameters();
      const encoding = params.encodings?.[0];
      if (!encoding) continue; // not negotiated yet; applied when signaling settles

      if (wanted === null) {
        if (encoding.maxBitrate === undefined) continue;
        delete encoding.maxBitrate;
      } else {
        if (encoding.maxBitrate === wanted) continue;
        encoding.maxBitrate = wanted;
      }
      await sender.setParameters(params);
    }
  }
}
