export type MediaFailure = "denied" | "no-device" | "in-use" | "insecure" | "unsupported" | "unknown";

export interface MediaError {
  kind: MediaFailure;
  title: string;
  hint: string;
}

/** Turns browser getUserMedia errors into copy a person can act on. */
export function describeMediaError(err: unknown): MediaError {
  const name = err instanceof DOMException ? err.name : err instanceof Error ? err.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return {
        kind: "denied",
        title: "Camera and microphone are blocked",
        hint: "Allow access in your browser's site settings, then try again.",
      };
    case "NotFoundError":
    case "OverconstrainedError":
      return {
        kind: "no-device",
        title: "No camera or microphone found",
        hint: "Connect a device and try again.",
      };
    case "NotReadableError":
    case "AbortError":
      return {
        kind: "in-use",
        title: "Your camera is being used by another app",
        hint: "Close other apps that use the camera, then try again.",
      };
    case "TypeError":
      return {
        kind: "insecure",
        title: "Camera access needs a secure page",
        hint: "Open the app over HTTPS or on localhost.",
      };
    default:
      return { kind: "unknown", title: "Couldn't start your camera", hint: "Reload the page and try again." };
  }
}
