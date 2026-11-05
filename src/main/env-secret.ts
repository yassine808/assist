import { readFileSync } from "node:fs";
import { createDecipheriv } from "node:crypto";
import { join } from "node:path";
import { app } from "electron";

/**
 * Reads the .env values that were sealed into the build by
 * `build/embed-env.mjs`.
 *
 * Layout of the sealed blob (`env.bin`), raw bytes:
 *
 *   [ 0..16)  second half of the AES-256 key
 *   [16..28)  GCM nonce
 *   [28..44)  GCM auth tag
 *   [44..  )  ciphertext of the JSON env object
 *
 * The first half of the key is compiled into this bundle as
 * `__RS_ENV_SHARD_A__` (electron.vite.config.ts), so neither the blob on disk
 * nor the bundle on its own is enough -- both are needed to recombine the key.
 * Nothing is written to disk: the plaintext lives in memory only while the
 * backend is being spawned.
 *
 * This is real crypto with a distributed key, not a guarantee. A local app that
 * can decrypt a secret can always be made to reveal it by a determined
 * attacker; see the note at the top of build/embed-env.mjs.
 */

declare const __RS_ENV_SHARD_A__: string;

const SHARD_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;

/** First half of the key, inlined at build time. Empty in unsealed builds. */
function keyShardA(): string {
  try {
    // `typeof` never throws for an identifier that was never defined, which is
    // what happens when the bundle is built without a sealed .env.
    return typeof __RS_ENV_SHARD_A__ === "string" ? __RS_ENV_SHARD_A__ : "";
  } catch {
    return "";
  }
}

function blobPath(): string {
  // Packaged: electron-builder copies env.bin into resources/ (extraResources).
  // Dev: straight from the build folder.
  return app.isPackaged ? join(process.resourcesPath, "env.bin") : join(app.getAppPath(), "build", "env.bin");
}

/**
 * Unseal `blob` with `shardA` (base64, 16 bytes). Any mismatch -- wrong shard,
 * truncated or tampered blob -- fails the GCM tag check and yields `{}`.
 */
export function openSealedEnv(blob: Buffer, shardA: string): Record<string, string> {
  try {
    const shard = Buffer.from(shardA, "base64");
    if (!shardA || shard.length !== SHARD_LEN || blob.length <= SHARD_LEN + IV_LEN + TAG_LEN) return {};

    const key = Buffer.concat([shard, blob.subarray(0, SHARD_LEN)]);
    const iv = blob.subarray(SHARD_LEN, SHARD_LEN + IV_LEN);
    const tag = blob.subarray(SHARD_LEN + IV_LEN, SHARD_LEN + IV_LEN + TAG_LEN);
    const body = blob.subarray(SHARD_LEN + IV_LEN + TAG_LEN);

    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
    const parsed: unknown = JSON.parse(json);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string>) : {};
  } catch {
    return {};
  }
}

let cache: Record<string, string> | null = null;

/** Values from the sealed build-time .env. Empty object when nothing was sealed. */
export function sealedEnv(): Record<string, string> {
  if (cache) return cache;
  const shardA = keyShardA();
  if (!shardA) {
    cache = {};
    return cache;
  }
  try {
    cache = openSealedEnv(readFileSync(blobPath()), shardA);
  } catch {
    cache = {};
  }
  return cache;
}
