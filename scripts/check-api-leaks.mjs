#!/usr/bin/env node
/**
 * Project-specific API-key leak check.
 *
 * CI has no `.env`, so the strongest local signal is a generic provider-key
 * scan plus a check that `.env` and its sealed build artifacts are not tracked.
 * When `.env` *is* present (developer machine), every value is also searched for
 * verbatim in the tracked source. Nothing is printed: the report names the file,
 * line and rule, never the secret.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { delimiter, extname } from "node:path";

const ROOT = process.cwd();
// Only fixed, non-user-writable directories: the scanner must never pick up a
// `git` planted earlier on a manipulated PATH.
const GIT_SEARCH_PATH = (
  process.platform === "win32"
    ? [String.raw`C:\Windows\System32`, String.raw`C:\Program Files\Git\cmd`]
    : ["/usr/local/bin", "/usr/bin", "/bin"]
).join(delimiter);
const SECRET_PATHS = [".env", "build/env.bin", "build/env-shard-a.bin"];
const SKIP_EXT = new Set([
  ".7z", ".apng", ".bin", ".db", ".dll", ".exe", ".gif", ".ico", ".jpg", ".jpeg",
  ".lock", ".pdf", ".png", ".webp", ".woff", ".woff2", ".zip",
]);
const SKIP_FILES = new Set(["package-lock.json"]);
const RENDERER_PREFIX = "src/renderer/";

const GENERIC_RULES = [
  { name: "private-key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: "openai-key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "github-token", re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

function git(args) {
  return execFileSync("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, PATH: GIT_SEARCH_PATH },
  });
}

function trackedFiles() {
  return git(["ls-files", "-z"])
    .split("\0")
    .filter(Boolean);
}

function envValues() {
  let text;
  try {
    text = readFileSync(`${ROOT}/.env`, "utf8");
  } catch {
    return [];
  }
  const values = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const value = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    // Placeholders and very short values are not useful leak candidates.
    if (value.length >= 12 && !/^(?:your[_-]?key|changeme|example|placeholder)/i.test(value)) {
      values.push(value);
    }
  }
  return values;
}

function isTextCandidate(path) {
  if (SKIP_FILES.has(path)) return false;
  if (SKIP_EXT.has(extname(path).toLowerCase())) return false;
  try {
    return statSync(`${ROOT}/${path}`).size <= 2 * 1024 * 1024;
  } catch {
    return false;
  }
}

const tracked = new Set(trackedFiles());
const failures = [];

for (const path of SECRET_PATHS) {
  if (tracked.has(path)) {
    failures.push(`${path}: tracked secret/build artifact (remove it from git)`);
  }
}

// A file removed from the working tree is still leaked if it ever entered
// history. Shallow checkouts cannot answer this, so CI checks out full history.
const historical = new Set(
  git(["log", "--all", "--format=", "--name-only"])
    .split(/\r?\n/)
    .filter(Boolean)
);
for (const path of SECRET_PATHS) {
  if (historical.has(path)) {
    failures.push(`${path}: present in git history (rotate the credential and purge history)`);
  }
}

const secrets = envValues();
for (const path of tracked) {
  if (!isTextCandidate(path)) continue;
  let content;
  try {
    content = readFileSync(`${ROOT}/${path}`, "utf8");
  } catch {
    continue;
  }
  if (content.includes("\0")) continue;

  if (path.startsWith(RENDERER_PREFIX) && /HENRIKDEV_API_KEY|env\.bin|env-shard-a\.bin/.test(content)) {
    failures.push(`${path}: renderer references the API-key bridge (keys belong in main/backend only)`);
  }

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const { name, re } of GENERIC_RULES) {
      if (re.test(line)) failures.push(`${path}:${i + 1}: ${name} pattern (do not commit credentials)`);
    }
    if (/\bHENRIKDEV_API_KEY\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/.test(line)) {
      failures.push(`${path}:${i + 1}: HENRIKDEV_API_KEY assignment with a value`);
    }
    if (secrets.some((secret) => line.includes(secret))) {
      failures.push(`${path}:${i + 1}: contains a value from .env`);
    }
  }
}

if (failures.length > 0) {
  console.error(`[api-leak] ${failures.length} issue(s) found:`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log(
  `[api-leak] clean: ${tracked.size} tracked files, ` +
  `${secrets.length} local .env value(s) checked, no tracked .env/sealed-env artifacts`
);
