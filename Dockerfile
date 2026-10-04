# Three images from one file:
#   server : the Node API + signaling server
#   web    : Caddy with the built app baked in (HTTPS, static files, reverse proxy)
#
# Build everything first, once.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
RUN npm ci
COPY packages packages
COPY apps apps
RUN npm run build -w @vc/web
# Drop build-only tools (vite, vitest, typescript) so the server image stays small.
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS server
ENV NODE_ENV=production \
    DATA_DIR=/data
WORKDIR /app
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/package.json /app/tsconfig.base.json ./
COPY --from=build /app/packages packages
COPY --from=build /app/apps/server apps/server
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]

FROM caddy:2 AS web
COPY --from=build /app/apps/web/dist /srv/web
COPY Caddyfile /etc/caddy/Caddyfile
