import { Router } from "express";
import { requireAuth } from "../auth/routes";
import type { TokenService } from "../auth/tokens";
import type { IceServerProvider } from "./iceServers";

export function createRtcRouter(opts: { provider: IceServerProvider; tokens: TokenService }): Router {
  const router = Router();

  // Signed-in people only: TURN relays real traffic, which costs bandwidth.
  router.get("/ice", requireAuth(opts.tokens), (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json(opts.provider.issue(res.locals.user.id));
  });

  return router;
}
