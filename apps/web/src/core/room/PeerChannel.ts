import type { SignalHandler, SignalMessage, SignalingChannel } from "../rtc/signaling";

/**
 * SignalingChannel bound to one remote peer. Messages that arrive before
 * anyone is listening are queued, so an early offer is never lost.
 */
export class PeerChannel implements SignalingChannel {
  private handlers = new Set<SignalHandler>();
  private queue: SignalMessage[] = [];

  constructor(private readonly sender: (message: SignalMessage) => void) {}

  send(message: SignalMessage): void {
    this.sender(message);
  }

  onMessage(handler: SignalHandler): () => void {
    this.handlers.add(handler);
    const queued = this.queue;
    this.queue = [];
    queued.forEach(handler);
    return () => this.handlers.delete(handler);
  }

  receive(message: SignalMessage): void {
    if (this.handlers.size === 0) this.queue.push(message);
    else this.handlers.forEach((h) => h(message));
  }
}
