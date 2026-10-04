import { useEffect, useRef, useState } from "react";
import { pickActiveSpeaker, type SpeakerState } from "../../core/media/activeSpeaker";

export interface SpeakerSource {
  id: string;
  stream: MediaStream | null;
  /** False while the person is muted, so their (silent) track never wins. */
  enabled: boolean;
}

/** Id of whoever is speaking now, measured with the Web Audio API. */
export function useActiveSpeaker(sources: SpeakerSource[]): string | null {
  const [active, setActive] = useState<string | null>(null);
  const latest = useRef(sources);
  latest.current = sources;
  const key = sources.map((s) => `${s.id}:${s.stream?.id ?? ""}`).join("|");

  useEffect(() => {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    void ctx.resume();

    const meters = latest.current.flatMap((s) => {
      if (!s.stream || s.stream.getAudioTracks().length === 0) return [];
      const source = ctx.createMediaStreamSource(s.stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser); // measured only: never connected to the speakers
      return [{ id: s.id, source, analyser, buffer: new Uint8Array(analyser.fftSize) }];
    });

    let state: SpeakerState = { id: null, lastLoudAt: 0 };
    const timer = setInterval(() => {
      const levels: Record<string, number> = {};
      for (const m of meters) {
        const enabled = latest.current.find((s) => s.id === m.id)?.enabled ?? false;
        m.analyser.getByteTimeDomainData(m.buffer);
        let sum = 0;
        for (const v of m.buffer) sum += ((v - 128) / 128) ** 2;
        levels[m.id] = enabled ? Math.sqrt(sum / m.buffer.length) : 0;
      }
      state = pickActiveSpeaker(levels, state, performance.now());
      setActive((prev) => (prev === state.id ? prev : state.id));
    }, 120);

    return () => {
      clearInterval(timer);
      meters.forEach((m) => m.source.disconnect());
      void ctx.close();
    };
  }, [key]);

  return active;
}
