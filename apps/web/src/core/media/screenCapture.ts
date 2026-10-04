export function canShareScreen(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";
}

/** Asks the browser to show its screen/window/tab picker. */
export async function captureScreen(): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 15, max: 30 } }, // sharp text matters more than smooth motion
    audio: false,
  });
  const track = stream.getVideoTracks()[0];
  if (track) track.contentHint = "detail"; // tells the encoder to keep text crisp
  return stream;
}

/** Closing the picker looks the same as denying permission; neither deserves an error message. */
export function isPickerDismissed(error: unknown): boolean {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError");
}
