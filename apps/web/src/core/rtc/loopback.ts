import type { SignalHandler, SignalMessage, SignalingChannel } from "./signaling";

class LoopbackChannel implements SignalingChannel {
  peer: LoopbackChannel | null = null;
  private handlers = new Set<SignalHandler>();

  send(message: SignalMessage): void {
    const target = this.peer;
    if (!target) return;
    // Serialize like a real network hop, and deliver asynchronously.
    const wire = JSON.stringify(message);
    queueMicrotask(() => {
      const copy = JSON.parse(wire) as SignalMessage;
      target.handlers.forEach((handler) => handler(copy));
    });
  }

  onMessage(handler: SignalHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }
}

/** Two connected channels: whatever one sends, only the other receives. */
export function createLoopbackPair(): [SignalingChannel, SignalingChannel] {
  const a = new LoopbackChannel();
  const b = new LoopbackChannel();
  a.peer = b;
  b.peer = a;
  return [a, b];
}
