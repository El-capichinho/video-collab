/**
 * Where the API and signaling server live.
 *  - Development: the server runs separately, on port 4000.
 *  - Production: a reverse proxy serves the app and the API from one address, so use that.
 * Override either with VITE_SERVER_URL when building.
 */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `http://${window.location.hostname}:4000` : window.location.origin);
