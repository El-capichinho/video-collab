import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Argon2idHasher } from "../modules/auth/passwordHasher";
import { FileBackedStore } from "../modules/auth/store";
import { DiskFileStorage } from "../modules/files/storage";
import { TokenService } from "../modules/auth/tokens";
import { createSignalingServer, type ServerOptions } from "../server";

export const TEST_ORIGIN = "http://localhost:5173";

export const TEST_ICE = {
  stunUrls: ["stun:stun.test:3478"],
  turnUrls: ["turn:turn.test:3478?transport=udp", "turn:turn.test:3478?transport=tcp"],
  turnSecret: "test-secret-test-secret-test-secret",
  ttlSeconds: 3600,
};

/** A real server on a random port, with cheap hashing so tests stay fast. */
export async function startTestServer(overrides: Partial<ServerOptions> = {}) {
  const uploadDir = await mkdtemp(join(tmpdir(), "vc-uploads-"));
  const tokens = TokenService.generate();
  const store = new FileBackedStore();
  const { httpServer, io } = createSignalingServer({
    origins: [TEST_ORIGIN],
    tokens,
    store,
    hasher: new Argon2idHasher({ memoryCost: 8192, timeCost: 1, parallelism: 1 }),
    storage: new DiskFileStorage(uploadDir),
    ice: TEST_ICE,
    maxRoomSize: 2,
    authRateLimit: { windowMs: 60_000, max: 1000 },
    ...overrides,
  });
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
  return {
    url,
    tokens,
    store,
    uploadDir,
    close: () => {
      void io.close();
      void rm(uploadDir, { recursive: true, force: true });
    },
  };
}
