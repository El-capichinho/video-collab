import { hash, verify } from "@node-rs/argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(hash: string, password: string): Promise<boolean>;
}

export interface Argon2Params {
  /** KiB of memory per hash. */
  memoryCost: number;
  timeCost: number;
  parallelism: number;
}

/** Argon2id (the library default) at 64 MiB, 3 passes: comfortably above OWASP's minimum. */
export const DEFAULT_ARGON2: Argon2Params = { memoryCost: 65536, timeCost: 3, parallelism: 1 };

export class Argon2idHasher implements PasswordHasher {
  constructor(private readonly params: Argon2Params = DEFAULT_ARGON2) {}

  hash(password: string): Promise<string> {
    return hash(password, this.params);
  }

  async verify(hashed: string, password: string): Promise<boolean> {
    try {
      return await verify(hashed, password);
    } catch {
      return false; // malformed hash: treat as a mismatch, never crash a login
    }
  }
}
