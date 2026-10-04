import { useEffect, useRef } from "react";
import { MicOffIcon } from "../../ui/icons";

interface Props {
  stream: MediaStream | null;
  label: string;
  camOn: boolean;
  micOn: boolean;
  mirrored?: boolean;
  muted?: boolean;
  /** Overlay message while the connection isn't healthy, e.g. "Connecting…". */
  note?: string;
  speaking?: boolean;
  /** Screens are shown whole (contain); cameras fill the tile (cover). */
  fit?: "cover" | "contain";
}

export function VideoTile({ stream, label, camOn, micOn, mirrored = false, muted = false, note, speaking = false, fit = "cover" }: Props) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);

  return (
    <figure className="tile" data-cam={camOn} data-speaking={speaking} data-fit={fit}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={muted}
        className={mirrored ? "mirrored" : undefined}
        aria-label={`${label} video`}
      />
      {!camOn && (
        <div className="tile-off" aria-hidden="true">
          <span className="avatar">{label.slice(0, 1).toUpperCase()}</span>
        </div>
      )}
      {note && <div className="tile-note">{note}</div>}
      <figcaption className="tile-name">
        {label}
        {!micOn && (
          <span className="muted-badge" role="img" aria-label="Muted">
            <MicOffIcon />
          </span>
        )}
      </figcaption>
    </figure>
  );
}
