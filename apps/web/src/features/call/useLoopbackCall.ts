import { useCallback, useEffect, useRef, useState } from "react";
import { createLoopbackPair } from "../../core/rtc/loopback";
import { PeerConnectionManager } from "../../core/rtc/PeerConnectionManager";

export type CallStatus = "idle" | "connecting" | "connected" | "failed";

/** Milestone 2: calls yourself using two peer connections on one page. */
export function useLoopbackCall(localStream: MediaStream | null) {
  const [status, setStatus] = useState<CallStatus>("idle");
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const peers = useRef<PeerConnectionManager[]>([]);

  const hangup = useCallback(() => {
    peers.current.forEach((p) => p.close());
    peers.current = [];
    setRemoteStream(null);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (!localStream || peers.current.length > 0) return;
    setStatus("connecting");

    const [callerSignal, calleeSignal] = createLoopbackPair();
    const caller = new PeerConnectionManager(callerSignal, {
      onStateChange: (state) => {
        if (state === "connected") setStatus("connected");
        else if (state === "failed") setStatus("failed");
      },
      onError: () => setStatus("failed"),
    });
    const callee = new PeerConnectionManager(calleeSignal, {
      onRemoteStream: setRemoteStream,
      onError: () => setStatus("failed"),
    });
    peers.current = [caller, callee];

    caller.addLocalStream(localStream);
    try {
      await caller.call();
    } catch {
      setStatus("failed");
    }
  }, [localStream]);

  // Ending the local preview ends the call; unmounting cleans up.
  useEffect(() => {
    if (!localStream) hangup();
  }, [localStream, hangup]);
  useEffect(() => hangup, [hangup]);

  return { status, remoteStream, start, hangup };
}
