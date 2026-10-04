import cookieParser from "cookie-parser";
import express, {
  Router,
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { rateLimit } from "express-rate-limit";
import { ZodError } from "zod";
import { LoginBody, RegisterBody, type ApiErrorBody, type AuthResponse } from "@vc/shared";
import { AuthError, type AuthService, type Session } from "./authService";
import type { TokenService } from "./tokens";

export const REFRESH_COOKIE = "vc_refresh";

export interface AuthRouterOptions {
  service: AuthService;
  tokens: TokenService;
  origins: string[];
  secureCookies: boolean;
  refreshTtlMs: number;
  rateLimit: { windowMs: number; max: number };
}

const errorBody = (code: string, message: string): ApiErrorBody => ({ error: { code, message } });

const handle =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** Rejects browser requests that come from a site we don't recognise. */
const originGuard =
  (origins: string[]): RequestHandler =>
  (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin)) {
      res.status(403).json(errorBody("forbidden_origin", "This request isn't allowed from this site."));
      return;
    }
    next();
  };

export function requireAuth(tokens: TokenService): RequestHandler {
  return async (req, res, next) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json(errorBody("unauthorized", "Sign in to continue."));
      return;
    }
    try {
      res.locals.user = await tokens.verifyAccess(token);
      next();
    } catch {
      res.status(401).json(errorBody("unauthorized", "Your session has expired. Sign in again."));
    }
  };
}

export function createAuthRouter(opts: AuthRouterOptions): Router {
  const { service, tokens } = opts;
  const router = Router();

  router.use(originGuard(opts.origins));
  router.use(express.json({ limit: "10kb" }));
  router.use(cookieParser());

  // Cookie only travels to /auth, is invisible to JavaScript, and is never sent cross-site.
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict",
    secure: opts.secureCookies,
    path: "/auth",
  } as const;

  const sendSession = (res: Response, session: Session, status = 200) => {
    res.cookie(REFRESH_COOKIE, session.refreshToken, { ...cookieOptions, maxAge: opts.refreshTtlMs });
    const body: AuthResponse = { user: session.user, accessToken: session.accessToken, expiresAt: session.expiresAt };
    res.status(status).json(body);
  };

  const limiter = rateLimit({
    windowMs: opts.rateLimit.windowMs,
    limit: opts.rateLimit.max,
    standardHeaders: true,
    legacyHeaders: false,
    message: errorBody("rate_limited", "Too many attempts. Wait a few minutes and try again."),
  });

  router.post("/register", limiter, handle(async (req, res) => {
    sendSession(res, await service.register(RegisterBody.parse(req.body)), 201);
  }));

  router.post("/login", limiter, handle(async (req, res) => {
    sendSession(res, await service.login(LoginBody.parse(req.body)));
  }));

  router.post("/refresh", handle(async (req, res) => {
    try {
      sendSession(res, await service.refresh(req.cookies?.[REFRESH_COOKIE]));
    } catch (err) {
      // A dead session should clear the cookie, but a race with another tab must not.
      if (err instanceof AuthError && err.code !== "refresh_in_progress") {
        res.clearCookie(REFRESH_COOKIE, cookieOptions);
      }
      throw err;
    }
  }));

  router.post("/logout", handle(async (req, res) => {
    await service.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, cookieOptions);
    res.status(204).end();
  }));

  router.get("/me", requireAuth(tokens), handle(async (_req, res) => {
    res.json({ user: await service.me(res.locals.user.id) });
  }));

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof AuthError) {
      res.status(err.status).json(errorBody(err.code, err.message));
    } else if (err instanceof ZodError) {
      res.status(400).json(errorBody("invalid_input", err.issues[0]?.message ?? "Check your details and try again."));
    } else if (err?.type === "entity.parse.failed") {
      res.status(400).json(errorBody("invalid_json", "The request couldn't be read."));
    } else if (err?.type === "entity.too.large") {
      res.status(413).json(errorBody("too_large", "The request is too large."));
    } else {
      console.error(err);
      res.status(500).json(errorBody("server_error", "Something went wrong. Try again."));
    }
  };
  router.use(onError);

  return router;
}
