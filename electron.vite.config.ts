import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
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
    plugins: [react()],
    resolve: {
      alias: {
        "@": resolve(__dirname, "src/renderer/src"),
      },
    },
  },
});
