/** Used if the server can't be asked. Enough for most home and office networks, not for strict firewalls. */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export interface IceServerSource {
  baseUrl: string;
  getToken: () => Promise<string>;
  fetchFn?: typeof fetch;
  timeoutMs?: number;
}

const ICE_URL = /^(stun|stuns|turn|turns):[^\s]+$/;

/** Accepts only well-formed entries, so a strange reply can't break call setup. */
export function parseIceServers(value: unknown): RTCIceServer[] {
  if (!Array.isArray(value)) return [];
  const servers: RTCIceServer[] = [];
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null) continue;
    const { urls, username, credential } = entry as Record<string, unknown>;
    const list = typeof urls === "string" ? [urls] : Array.isArray(urls) ? urls : [];
    if (list.length === 0 || !list.every((u) => typeof u === "string" && ICE_URL.test(u))) continue;
    const server: RTCIceServer = { urls: list as string[] };
    if (typeof username === "string") server.username = username;
    if (typeof credential === "string") server.credential = credential;
    servers.push(server);
  }
  return servers;
}

/**
 * Asks the server for ICE servers, including short-lived TURN credentials made for
 * this person. Never fails: a slow or broken reply means falling back to plain STUN
 * rather than stopping someone from joining.
 */
export async function fetchIceServers({ baseUrl, getToken, fetchFn, timeoutMs = 4000 }: IceServerSource): Promise<RTCIceServer[]> {
  const doFetch = fetchFn ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const token = await getToken();
    const response = await doFetch(`${baseUrl}/rtc/ice`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) return FALLBACK_ICE_SERVERS;
    const body = (await response.json()) as { iceServers?: unknown };
    const servers = parseIceServers(body.iceServers);
    return servers.length > 0 ? servers : FALLBACK_ICE_SERVERS;
  } catch {
    return FALLBACK_ICE_SERVERS;
  } finally {
    clearTimeout(timer);
  }
}
