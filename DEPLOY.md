# Deploying Video Collab

This puts the app on a server with HTTPS and a TURN relay, so people can join from home, the office, or a phone, on any network. It takes about 30 minutes the first time.

## What you need

- A server (VPS) running Linux with a **public IP address**. 1 CPU and 2 GB of memory is enough for small groups.
- A **domain name** you control (for example `meet.example.com`).
- **Docker** with the Compose plugin installed on the server.

## 1. Point your domain at the server

Create an **A record** for your domain pointing to the server's public IP. Wait until it resolves (`nslookup meet.example.com`).

## 2. Open the firewall

Both your cloud provider's firewall and the server's own (`ufw`) need these:

| Port | Protocol | Why |
|---|---|---|
| 80 | TCP | HTTPS certificate setup, and redirecting to HTTPS |
| 443 | TCP and UDP | The app itself |
| 3478 | TCP and UDP | TURN relay |
| 49160–49200 | UDP | Media relayed by TURN |

## 3. Get the code and create your secrets

```bash
git clone <your repository> video-collab && cd video-collab
./scripts/generate-env.sh meet.example.com 203.0.113.10   # your domain, then the server's PUBLIC IP
```

This writes `.env` with a fresh signing key and TURN secret. **Keep `.env` private and back it up.** The script refuses to overwrite an existing one, because new secrets sign everyone out.

## 4. Start it

```bash
docker compose up -d --build
docker compose logs -f
```

The first start takes a minute: Caddy requests the HTTPS certificate automatically. When the logs mention the certificate being obtained, open **https://meet.example.com**.

## 5. Check that it works

1. **Create an account** and join a room.
2. **Join from a second device on a different network** (a phone on mobile data is ideal) using the invite link. You should see each other.
3. **Prove TURN works.** Open the app with `?relay` on the end (`https://meet.example.com/?relay`) on both devices and join the same room. This forces every call through the relay. If the video still connects, TURN is working. If it hangs on "Connecting…", see Troubleshooting.

For a second opinion on TURN, open the [Trickle ICE test page](https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/). In your app (signed in), open the browser's developer tools, Network tab, find the `ice` request, and copy a TURN `username` and `credential` from the response. Enter `turn:meet.example.com:3478`, click *Gather candidates*, and look for a candidate of type **relay**. Credentials last 6 hours.

## Day-to-day

| Task | Command |
|---|---|
| See logs | `docker compose logs -f server` (or `caddy`, `coturn`) |
| Update to new code | `git pull && docker compose up -d --build` |
| Restart | `docker compose restart` |
| Stop | `docker compose down` (add `-v` only if you want to **delete all accounts**) |

**Back up** the `.env` file and the `app_data` volume (it holds accounts and sessions). Also keep the `caddy_data` volume: it holds your HTTPS certificates, and recreating it too often runs into Let's Encrypt's rate limits.

## Settings (all in `docker-compose.yml`)

| Variable | Meaning |
|---|---|
| `CLIENT_ORIGIN` | The one address people open. Must be exactly `https://your-domain`, no trailing slash |
| `TRUST_PROXY` | Number of reverse proxies in front of the server. `1` with the included Caddy |
| `JWT_PRIVATE_KEY` | Signs login tokens. Changing it signs everyone out |
| `TURN_URLS`, `TURN_SECRET` | Where the relay is, and the secret it shares with the server |
| `TURN_TTL_SECONDS` | How long relay credentials last (default 6 hours) |

The server **refuses to start** with a clear list of problems if a required setting is missing or wrong, so a mistake is obvious in `docker compose logs server`, not a mystery later.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| No HTTPS certificate, browser warning | DNS doesn't point at this server yet, or port 80 is blocked |
| "Can't reach the server" on the sign-in page | `CLIENT_ORIGIN` doesn't exactly match the address in the browser bar |
| Camera or microphone unavailable | Not on `https://`. Browsers only allow the camera on secure pages |
| Works on the same Wi-Fi, fails between networks | TURN isn't reachable: check ports 3478 and 49160–49200 are open, and `TURN_EXTERNAL_IP` is the **public** IP |
| `?relay` hangs on "Connecting…" | Same as above. Check `docker compose logs coturn` |
| Everyone gets "too many attempts" | `TRUST_PROXY` is 0 behind a proxy, so all visitors look like one |
| Server won't start | Read `docker compose logs server`: it lists every setting that's wrong |
| Page loads but looks broken, console mentions "Content Security Policy" | See *Security headers* below |

## Security headers

`Caddyfile` sets a strict Content-Security-Policy, HSTS, and a Permissions-Policy that allows only the camera, microphone, and screen capture. The built app was checked for anything such a policy blocks (inline scripts, `eval`), but **it has not been exercised in a real browser**. If you see the page misbehave and the browser console reports a "Content Security Policy" violation, the message names exactly which rule to adjust in `Caddyfile`.

## What this setup does not do (yet)

- **One server only.** Rooms live in the server's memory, so it can't be spread across several machines. One small server comfortably serves many small rooms.
- **Accounts are stored in a file** (`store.json` in the `app_data` volume). That is safe and atomic, and fine for hundreds of users. A real database (Postgres) is the next step if you outgrow it.
- **Uploaded files are cleared when the server restarts**, and deleted when a room empties.
- **Calls are mesh**: every person connects to every other, so rooms are capped at 6. Bigger meetings need a media server (an SFU).
- **TURN uses port 3478 only.** Some corporate networks block everything except ports 80 and 443. Serving TURN over TLS on 443 fixes that, and needs a certificate for the relay.
- **Not load tested**, and not hardened against a determined attacker beyond the measures in the code (rate limits, validation, signed links, size limits).

## What was and wasn't tested

Tested here: a clean install from the lockfile, the production build, the production start-up and its error messages, graceful shutdown, the `Caddyfile` run through a real Caddy in front of the real server (headers, caching, deep links, API, WebSockets, a 20 MB upload and download, login rate limits behind the proxy), the secret generator, and TURN credential generation.

**Not tested** (no Docker or TURN server was available): the Docker images and `docker-compose.yml` themselves, the coturn configuration and a real relayed call, certificate issuance from Let's Encrypt, and the app in a real browser behind the security headers. Step 5 above is how you verify those on your server.
