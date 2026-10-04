import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { MediaState } from "@vc/shared";
import type { BoardPort } from "../../core/board/types";
import type { FilePort } from "../../core/files/FileShelf";
import { SERVER_URL } from "../../core/config";
import { canShareScreen, captureScreen, isPickerDismissed } from "../../core/media/screenCapture";
import { MeshCoordinator } from "../../core/room/MeshCoordinator";
import { RoomClient } from "../../core/room/RoomClient";
import { fetchIceServers } from "../../core/rtc/iceServers";
import { PeerConnectionManager } from "../../core/rtc/PeerConnectionManager";

export type { RemotePeer, RoomStatus } from "../../core/room/MeshCoordinator";

/**
 * Opening the app with ?relay forces every call through the TURN server. If a call still
 * connects, TURN is working. Handy right after a deployment, and harmless otherwise.
 */
const FORCE_RELAY = new URLSearchParams(window.location.search).has("relay");

/** React binding for MeshCoordinator: all the call logic lives there. */
export function useRoom(
  localStream: MediaStream | null,
  getToken: () => Promise<string>,
  media: MediaState,
  extras: { board?: BoardPort; files?: FilePort } = {},
) {
  const { board, files } = extras;
  const coordinator = useMemo(
    () =>
      new MeshCoordinator({
        createTransport: (events) => new RoomClient(SERVER_URL, getToken, events),
        loadIceServers: () => fetchIceServers({ baseUrl: SERVER_URL, getToken }),
        createPeer: (channel, events, options) =>
          new PeerConnectionManager(channel, events, {
            polite: options.polite,
            config: options.iceServers
              ? { iceServers: options.iceServers, iceTransportPolicy: FORCE_RELAY ? "relay" : "all" }
              : undefined,
          }),
        board,
        files,
      }),
    [getToken, board, files],
  );
  const snapshot = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot);

  // Turning the camera off, or leaving the page, ends the room too.
  useEffect(() => {
    if (!localStream) coordinator.leave();
  }, [localStream, coordinator]);
  useEffect(() => coordinator.leave, [coordinator]);

  const { micOn, camOn } = media;
  useEffect(() => {
    coordinator.setMedia({ micOn, camOn });
  }, [coordinator, micOn, camOn]);

  const join = useCallback(
    (roomId: string) => {
      if (localStream) coordinator.join(roomId, localStream, { micOn, camOn });
    },
    [coordinator, localStream, micOn, camOn],
  );

  const startShare = useCallback(async () => {
    try {
      coordinator.startShare(await captureScreen());
    } catch (error) {
      if (!isPickerDismissed(error)) coordinator.notify("Couldn't start screen sharing. Try again.");
    }
  }, [coordinator]);

  return {
    ...snapshot,
    join,
    leave: coordinator.leave,
    canShare: canShareScreen(),
    startShare,
    stopShare: coordinator.stopShare,
    clearNotice: coordinator.clearNotice,
  };
}
