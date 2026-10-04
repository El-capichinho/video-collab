import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MediaDevicesService } from "../../core/media/MediaDevicesService";
import { describeMediaError, type MediaError } from "../../core/media/errors";

export type MediaStatus = "idle" | "requesting" | "live" | "failed";

export function useLocalMedia() {
  const service = useMemo(() => new MediaDevicesService(), []);
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [error, setError] = useState<MediaError | null>(null);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const mounted = useRef(true);

  const start = useCallback(async () => {
    setStatus("requesting");
    setError(null);
    try {
      const s = await service.start();
      if (!mounted.current) return service.stop();
      setStream(s);
      setMicOn(true);
      setCamOn(true);
      setStatus("live");
    } catch (e) {
      if (!mounted.current) return;
      setError(describeMediaError(e));
      setStatus("failed");
    }
  }, [service]);

  const stop = useCallback(() => {
    service.stop();
    setStream(null);
    setStatus("idle");
  }, [service]);

  const toggleMic = useCallback(() => {
    setMicOn((on) => {
      service.setEnabled("audio", !on);
      return !on;
    });
  }, [service]);

  const toggleCam = useCallback(() => {
    setCamOn((on) => {
      service.setEnabled("video", !on);
      return !on;
    });
  }, [service]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      service.stop();
    };
  }, [service]);

  return { status, stream, error, micOn, camOn, start, stop, toggleMic, toggleCam };
}
