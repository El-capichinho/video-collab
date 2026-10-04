import type { MediaState, ShareState } from "@vc/shared";

export interface RoomMember {
  /** The account, as opposed to the socket: file downloads over HTTP are checked against this. */
  userId: string;
  displayName: string;
  media: MediaState;
  share: ShareState;
}

/** Who is in which room right now. Shared by the socket handlers and the HTTP file routes. */
export class RoomDirectory {
  /** roomId -> (socketId -> member) */
  readonly rooms = new Map<string, Map<string, RoomMember>>();

  isUserInRoom(roomId: string, userId: string): boolean {
    const members = this.rooms.get(roomId);
    if (!members) return false;
    for (const member of members.values()) if (member.userId === userId) return true;
    return false;
  }
}
