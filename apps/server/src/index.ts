import { join } from "node:path";
import { ConfigError, loadConfig } from "./config";
import { Argon2idHasher } from "./modules/auth/passwordHasher";
import { FileBackedStore } from "./modules/auth/store";
import { loadTokenService } from "./modules/auth/tokens";
import { DiskFileStorage } from "./modules/files/storage";
import { createSignalingServer } from "./server";

let config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(error.message);
  process.exit(1);
}
for (const warning of config.warnings) console.warn(`Warning: ${warning}`);

const tokens = loadTokenService({
  pem: config.jwtPrivateKey,
  keyFile: join(config.dataDir, "jwt-private.pem"),
});
const store = new FileBackedStore(join(config.dataDir, "store.json"));

// Rooms live in memory, so after a restart no room owns these files any more.
const storage = new DiskFileStorage(join(config.dataDir, "uploads"));
await storage.clear();

const { httpServer, io } = createSignalingServer({
  origins: config.origins,
  tokens,
  store,
  hasher: new Argon2idHasher(),
  storage,
  ice: config.ice,
  trustProxy: config.trustProxy,
  secureCookies: config.production,
});

httpServer.listen(config.port, () => {
  console.log(`Signaling server on :${config.port} (${config.production ? "production" : "development"})`);
});

// Containers are stopped with SIGTERM: finish up instead of being killed mid-request.
const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down`);
  io.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
