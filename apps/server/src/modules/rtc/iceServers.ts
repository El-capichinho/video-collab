import { createHmac } from "node:crypto";

export interface IceConfig {
  stunUrls: string[];
  turnUrls: string[];
  /** Shared with the TURN server (coturn's static-auth-secret). Never sent to browsers. */
  turnSecret?: string;
  /** How long issued TURN credentials stay valid. */
  ttlSeconds: number;
}

export interface IceServerEntry {
  urls: string[];
  username?: string;
  credential?: string;
}

export interface IceServerReply {
  iceServers: IceServerEntry[];
  ttlSeconds: number;
}

/**
 * Hands out ICE servers, with short-lived TURN credentials made the way coturn's
 * "REST API" mode expects: username = "<expiry>:<user>", password = HMAC-SHA1 of the
 * username with the shared secret. The TURN server checks this itself, so it needs no
 * database, and a leaked credential stops working when it expires.
 */
export class IceServerProvider {
  constructor(
    private readonly config: IceConfig,
    private readonly now: () => number = Date.now,
  ) {}

  issue(userId: string): IceServerReply {
    const { stunUrls, turnUrls, turnSecret, ttlSeconds } = this.config;
    const iceServers: IceServerEntry[] = [];

    if (stunUrls.length > 0) iceServers.push({ urls: stunUrls });

    if (turnUrls.length > 0 && turnSecret) {
      const expiry = Math.floor(this.now() / 1000) + ttlSeconds;
      const username = `${expiry}:${userId}`;
      const credential = createHmac("sha1", turnSecret).update(username).digest("base64");
      iceServers.push({ urls: turnUrls, username, credential });
    }
    return { iceServers, ttlSeconds };
  }
}
