import { describe, expect, it } from "vitest";
import { PeerChannel } from "./PeerChannel";
import type { SignalMessage } from "../rtc/signaling";

const offer: SignalMessage = { kind: "description", description: { type: "offer", sdp: "o" } };

describe("PeerChannel", () => {
  it("queues messages until a listener subscribes", () => {
    const channel = new PeerChannel(() => {});
    channel.receive(offer);
    const seen: SignalMessage[] = [];
    channel.onMessage((m) => seen.push(m));
    expect(seen).toEqual([offer]);
  });

  it("delivers live messages and stops after unsubscribe", () => {
    const channel = new PeerChannel(() => {});
    const seen: SignalMessage[] = [];
    const off = channel.onMessage((m) => seen.push(m));
    channel.receive(offer);
    off();
    channel.receive(offer);
    expect(seen).toHaveLength(1);
  });

  it("sends through the provided sender", () => {
    const sent: SignalMessage[] = [];
    new PeerChannel((m) => sent.push(m)).send(offer);
    expect(sent).toEqual([offer]);
  });
});
