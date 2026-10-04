/**
 * Facade over navigator.mediaDevices. UI code never calls getUserMedia directly,
 * so the same service can later feed PeerConnectionManager.
 */
export type TrackKind = "audio" | "video";

const DEFAULT_CONSTRAINTS: MediaStreamConstraints = {
  audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
};

export class MediaDevicesService {
  private stream: MediaStream | null = null;

  async start(constraints: MediaStreamConstraints = DEFAULT_CONSTRAINTS): Promise<MediaStream> {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia(constraints);
    return this.stream;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }

  /** Enable/disable without releasing the device, so unmuting is instant. */
  setEnabled(kind: TrackKind, enabled: boolean): void {
    const tracks = kind === "audio" ? this.stream?.getAudioTracks() : this.stream?.getVideoTracks();
    tracks?.forEach((t) => (t.enabled = enabled));
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    return navigator.mediaDevices.enumerateDevices();
  }
}
