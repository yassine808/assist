#!/usr/bin/env node
/**
 * Build-time .env encryptor for the packaged app.
 *
 * The portable build has to work on machines that never see a .env file, so the
 * API keys must travel inside the artifact. Shipping them as a plain text file
 * next to the exe is a one-click leak: the portable target is a self-extracting
 * archive, so anybody can open it and read `.env`.
 *
 * This script removes the plaintext from the build:
 *
 *   1. `.env` is parsed into a JSON object.
 *   2. The object is sealed with AES-256-GCM under a fresh random 256-bit key.
 *   3. The ciphertext, IV and tag go to `build/env.bin`.
 *   4. The key is split in half. The second half goes into `build/env.bin`; the
 *      first half goes to `build/env-shard-a.bin`, which electron-vite inlines
 *      into the main-process bundle (see `electron.vite.config.ts`).
 *
 * Decryption therefore needs two artifacts that live in different layers of the
 * packaged app, and the plaintext never touches the disk at runtime -- see
 * `src/main/env-secret.ts`.
 *
 * Limitation worth knowing: this is deterrence, not secrecy. Anybody who can run
 * the app can eventually recover a key the app decrypts locally. If the key ever
 * needs to be genuinely unextractable, the API calls have to move behind a
 * server the operator controls.
 *
 * Usage:  node build/embed-env.mjs [--env <path>] [--quiet]
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export const BLOB_PATH = join(ROOT, "build", "env.bin");
export const SHARD_PATH = join(ROOT, "build", "env-shard-a.bin");

const SHARD_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
const KEY_LEN = 32;

/** Parse the `KEY=value` lines of a dotenv file. Comments and blanks are dropped. */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    // `export KEY=value` shows up in hand-edited env files often enough to handle.
    const name = key.startsWith("export ") ? key.slice(7).trim() : key;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (name) out[name] = value;
  }
  return out;
}

/** Seal `env` under `key`. Returns `shardB | iv | tag | ciphertext`. */
export function encryptEnv(env, key) {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(env), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([key.subarray(SHARD_LEN), iv, cipher.getAuthTag(), body]);
}

/** Inverse of {@link encryptEnv}; `shardA` is the first half of the key. */
export function decryptEnv(blob, shardA) {
  if (shardA.length !== SHARD_LEN) throw new Error("bad key shard");
  const key = Buffer.concat([shardA, blob.subarray(0, SHARD_LEN)]);
  const iv = blob.subarray(SHARD_LEN, SHARD_LEN + IV_LEN);
  const tag = blob.subarray(SHARD_LEN + IV_LEN, SHARD_LEN + IV_LEN + TAG_LEN);
  const body = blob.subarray(SHARD_LEN + IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const text = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  return JSON.parse(text);
}

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function main() {
  const quiet = process.argv.includes("--quiet");
  const envPath = argValue("--env") ?? join(ROOT, ".env");

  if (!existsSync(envPath)) {
    // CI and fresh clones have no .env. Build anyway: the app simply ships
    // without a bundled key and falls back to the environment or a user .env.
    console.warn(`[embed-env] no ${envPath} found - building without a bundled key`);
    return;
  }

  const env = parseEnv(readFileSync(envPath, "utf8"));
  const names = Object.keys(env);
  if (names.length === 0) {
    console.warn("[embed-env] .env has no KEY=value entries - nothing to embed");
    return;
  }

  const key = randomBytes(KEY_LEN);
  const blob = encryptEnv(env, key);

  mkdirSync(dirname(BLOB_PATH), { recursive: true });
  writeFileSync(BLOB_PATH, blob);
  writeFileSync(SHARD_PATH, key.subarray(0, SHARD_LEN));

  if (!quiet) {
    console.log(
      `[embed-env] sealed ${names.length} key(s) (${names.join(", ")}) ` +
        `into build/env.bin (${blob.length} bytes)`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
