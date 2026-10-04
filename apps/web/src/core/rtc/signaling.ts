/**
 * Strategy interface for moving signaling messages between two peers.
 * Milestone 2 uses an in-memory loopback; milestone 3 swaps in Socket.io
 * without touching PeerConnectionManager.
 */
export type SignalMessage =
  | { kind: "description"; description: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

export type SignalHandler = (message: SignalMessage) => void;

export interface SignalingChannel {
  send(message: SignalMessage): void;
  /** Returns an unsubscribe function. */
  onMessage(handler: SignalHandler): () => void;
}
