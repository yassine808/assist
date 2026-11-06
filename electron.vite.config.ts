import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";

/**
 * First half of the key that unseals the bundled .env (see build/embed-env.mjs).
 * Inlining it into the main bundle keeps it out of the resources folder, so
 * reading the plaintext requires the ciphertext from `resources/env.bin` *and*
 * the main process code.
 */
function envKeyShard(): string {
  try {
    return readFileSync(resolve(__dirname, "build/env-shard-a.bin")).toString("base64");
  } catch {
    // Not sealed yet (fresh clone, CI without .env): ship without a key.
    return "";
  }
}

/**
 * Vite's dev server injects CSS through inline <style> tags, which the strict
 * production CSP forbids. Relax only the dev server's policy; the built app
 * keeps `style-src 'self'` because its CSS is emitted as a linked stylesheet
 * and React writes style properties through the CSSOM, not inline attributes.
 */
function devCspPlugin(): Plugin {
  return {
    name: "dev-csp-unsafe-inline",
    apply: "serve",
    transformIndexHtml(html) {
      return html
        .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
        .replace("connect-src 'self'", "connect-src 'self' ws: http: https:");
    },
  };
}

export default defineConfig({
  main: {
    define: {
      __RS_ENV_SHARD_A__: JSON.stringify(envKeyShard()),
    },
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/main/index.ts") },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { preload: resolve(__dirname, "src/main/preload.ts") },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, "src/renderer"),
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, "src/renderer/index.html") },
      },
    },
    plugins: [react(), devCspPlugin()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
  },
});
