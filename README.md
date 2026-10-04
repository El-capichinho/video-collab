# Video Collab

Video conferencing + collaboration tool (WebRTC, Socket.io, TypeScript).

```
packages/shared   Zod schemas + types for signaling events (client + server)
apps/server       Node + Express + Socket.io signaling server
apps/web          React + Vite client
```

## Run

```bash
npm install
npm run dev:web      # http://localhost:5173
npm run dev:server   # http://localhost:4000/health
npm run typecheck
npm test
```

## Deploying

See **[DEPLOY.md](DEPLOY.md)** for putting this on a server with HTTPS and a TURN relay.

## Server configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | Server port |
| `CLIENT_ORIGIN` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated allowed browser origins |
| `DATA_DIR` | `./.data` | Where the dev user store, signing key and shared files (`uploads/`) are saved. Uploads are cleared on every start, since rooms don't survive a restart |
| `JWT_PRIVATE_KEY` | *(generated in dev)* | Ed25519 private key (PKCS8 PEM). **Required in production** |
| `NODE_ENV` | | `production` turns on Secure cookies and strict startup checks |
| `TRUST_PROXY` | `0` | Number of reverse proxies in front (1 with the included Caddy). Needed for per-visitor rate limits |
| `STUN_URLS` | Google's public STUN | Comma-separated `stun:` addresses |
| `TURN_URLS`, `TURN_SECRET` | none | TURN relay addresses, and the secret shared with it. See DEPLOY.md |
| `TURN_TTL_SECONDS` | `21600` | Lifetime of the TURN credentials handed to browsers |
| `JWT_PRIVATE_KEY_FILE` | | Alternative to `JWT_PRIVATE_KEY`: path to a key file |

Open the app at `http://localhost:5173` consistently. Mixing `localhost` and
`127.0.0.1` makes the browser treat them as different sites and drops the login cookie.

## Milestones
1. [x] Monorepo + camera/mic preview with mute/camera toggles
2. [x] Two-peer call on one page (RTCPeerConnection)
3. [x] Signaling + rooms across browsers (Socket.io)
4. [x] Auth (Argon2id + JWT via jose), authenticated sockets
5. [x] Multi-user mesh + call UI
6. [x] Screen sharing · 7. [x] Whiteboard · 8. [x] File sharing
9. [~] Deployment: TURN relay, HTTPS, production config done (see DEPLOY.md). Still to do: real database, whiteboard rate limits
