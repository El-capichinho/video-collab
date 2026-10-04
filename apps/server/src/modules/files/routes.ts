import { Router, type ErrorRequestHandler, type Request, type RequestHandler, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { RoomId, type ApiErrorBody } from "@vc/shared";
import { requireAuth } from "../auth/routes";
import type { TokenService } from "../auth/tokens";
import { contentDisposition } from "./contentDisposition";
import { FileError, type FileService } from "./fileService";

export interface FilesRouterOptions {
  service: FileService;
  tokens: TokenService;
  rateLimit: { windowMs: number; max: number };
}

const errorBody = (code: string, message: string): ApiErrorBody => ({ error: { code, message } });

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

function decodeName(header: string | undefined): string {
  if (!header) return "";
  try {
    return decodeURIComponent(header);
  } catch {
    return "";
  }
}

const validRoom = (value: string) => RoomId.safeParse(value).success;

export function createFilesRouter({ service, tokens, rateLimit: limit }: FilesRouterOptions): Router {
  const router = Router();

  const uploadLimiter = rateLimit({
    windowMs: limit.windowMs,
    limit: limit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: errorBody("rate_limited", "You're uploading too quickly. Wait a moment and try again."),
  });

  // Plain navigation can't send an Authorization header, so this route trusts the signed link instead.
  router.get("/download/:token", handle(async (req, res) => {
    const { file, stream } = service.open(req.params.token ?? "");
    res.status(200);
    res.setHeader("Content-Type", "application/octet-stream"); // never let the browser guess and render it
    res.setHeader("Content-Disposition", contentDisposition(file.name));
    res.setHeader("Content-Length", String(file.size));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }));

  router.put("/:roomId", uploadLimiter, requireAuth(tokens), handle(async (req, res) => {
    const roomId = req.params.roomId ?? "";
    if (!validRoom(roomId)) throw new FileError(400, "bad_room", "That room name isn't valid.");

    const length = Number(req.headers["content-length"]);
    if (req.headers["content-length"] === undefined || !Number.isInteger(length) || length < 0) {
      throw new FileError(411, "length_required", "The upload didn't say how big it is.");
    }
    const name = decodeName(req.header("x-file-name"));
    const file = await service.upload(res.locals.user, roomId, name, length, req);
    res.status(201).json({ file });
  }));

  router.post("/:roomId/:fileId/link", requireAuth(tokens), handle(async (req, res) => {
    const roomId = req.params.roomId ?? "";
    if (!validRoom(roomId)) throw new FileError(400, "bad_room", "That room name isn't valid.");
    const token = service.createLink(res.locals.user, roomId, req.params.fileId ?? "");
    res.json({ url: `/files/download/${token}` });
  }));

  router.delete("/:roomId/:fileId", requireAuth(tokens), handle(async (req, res) => {
    const roomId = req.params.roomId ?? "";
    if (!validRoom(roomId)) throw new FileError(400, "bad_room", "That room name isn't valid.");
    await service.remove(res.locals.user, roomId, req.params.fileId ?? "");
    res.status(204).end();
  }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof FileError) {
      // Rejecting before the body is read: close the connection rather than swallow a huge upload.
      if (err.status === 413 || err.status === 415) res.setHeader("Connection", "close");
      res.status(err.status).json(errorBody(err.code, err.message));
    } else if (err?.code === "ERR_STREAM_PREMATURE_CLOSE" || err?.code === "ECONNRESET") {
      // The uploader gave up part-way. Nothing to report to anyone.
      if (!res.headersSent) res.status(400).end();
    } else {
      console.error(err);
      if (!res.headersSent) res.status(500).json(errorBody("server_error", "Something went wrong. Try again."));
    }
  };
  router.use(onError);

  return router;
}
