import { createServer } from "node:http";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { AuthService } from "./modules/auth/authService";
import type { PasswordHasher } from "./modules/auth/passwordHasher";
import type { BoardLimits } from "./modules/board/board";
import { createAuthRouter } from "./modules/auth/routes";
import { DownloadLinks } from "./modules/files/downloadLinks";
import { FileService } from "./modules/files/fileService";
import { FileRegistry } from "./modules/files/registry";
import { createFilesRouter } from "./modules/files/routes";
import { IceServerProvider, type IceConfig } from "./modules/rtc/iceServers";
import { createRtcRouter } from "./modules/rtc/routes";
import type { FileStorage } from "./modules/files/storage";
import { RoomDirectory } from "./modules/rooms/directory";
import { FILE_LIMITS, type FileLimits } from "@vc/shared";
import type { TokenService } from "./modules/auth/tokens";
import type { RefreshTokenRepository, UserRepository } from "./modules/auth/types";
import {
  registerSignalingHandlers,
  requireSocketAuth,
  type SignalingServer,
} from "./modules/signaling/handlers";

export interface ServerOptions {
  origins: string[];
  tokens: TokenService;
  store: UserRepository & RefreshTokenRepository;
  hasher: PasswordHasher;
  storage: FileStorage;
  ice: IceConfig;
  /** Number of reverse proxies in front of this server (0 if none). */
  trustProxy?: number;
  /** Mesh calls get heavy quickly; cap room size until an SFU is added. */
  maxRoomSize?: number;
  boardLimits?: Partial<BoardLimits>;
  fileLimits?: Partial<FileLimits>;
  /** Applies to uploads, per IP. */
  fileRateLimit?: { windowMs: number; max: number };
  downloadLinkTtlMs?: number;
  secureCookies?: boolean;
  refreshTtlMs?: number;
  refreshGraceMs?: number;
  /** Applies to login and registration, per IP. */
  authRateLimit?: { windowMs: number; max: number };
}

export function createSignalingServer(options: ServerOptions) {
  const {
    origins,
    tokens,
    store,
    hasher,
    storage,
    ice,
    trustProxy = 0,
    maxRoomSize = 6,
    boardLimits,
    fileLimits,
    downloadLinkTtlMs,
    fileRateLimit = { windowMs: 60_000, max: 30 },
    secureCookies = false,
    refreshTtlMs = 7 * 24 * 60 * 60 * 1000,
    refreshGraceMs,
    authRateLimit = { windowMs: 15 * 60 * 1000, max: 20 },
  } = options;

  const service = new AuthService({
    users: store,
    refreshTokens: store,
    hasher,
    tokens,
    refreshTtlMs,
    refreshGraceMs,
  });

  const app = express();
  // Only believe X-Forwarded-For from proxies we run. Otherwise anyone could fake their address and dodge rate limits.
  if (trustProxy > 0) app.set("trust proxy", trustProxy);
  app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
  app.use(cors({ origin: origins, credentials: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.use(
    "/auth",
    createAuthRouter({ service, tokens, origins, secureCookies, refreshTtlMs, rateLimit: authRateLimit }),
  );

  app.use("/rtc", createRtcRouter({ provider: new IceServerProvider(ice), tokens }));

  const httpServer = createServer(app);
  const io: SignalingServer = new Server(httpServer, { cors: { origin: origins } });
  requireSocketAuth(io, tokens);

  const directory = new RoomDirectory();
  const files = new FileService({
    registry: new FileRegistry(),
    storage,
    directory,
    links: new DownloadLinks({ ttlMs: downloadLinkTtlMs }),
    limits: { ...FILE_LIMITS, ...fileLimits },
    notifier: {
      added: (roomId, file) => void io.to(roomId).emit("file:added", { file }),
      removed: (roomId, fileId) => void io.to(roomId).emit("file:removed", { fileId }),
    },
  });
  app.use("/files", createFilesRouter({ service: files, tokens, rateLimit: fileRateLimit }));

  registerSignalingHandlers(io, {
    maxRoomSize,
    boardLimits,
    directory,
    files: {
      list: (roomId) => files.list(roomId),
      roomEmptied: (roomId) => void files.dropRoom(roomId).catch((error) => console.error(error)),
    },
  });

  return { httpServer, io };
}
