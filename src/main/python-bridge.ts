import { ChildProcess, spawn } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { app } from "electron";
/**
 * Spawns the Python backend as a child process and communicates via
 * JSON-line protocol over stdin/stdout.
 *
 * Request:  {"id":1,"method":"get_profiles","params":{}}\n
 * Response: {"id":1,"result":{...}}\n
 * Event:    {"event":"valorant_data_updated","params":{...}}\n
 */

function loadEnvKey(): string {
  try {
    const envPath = join(app.isPackaged ? process.resourcesPath : app.getAppPath(), ".env");
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      if (trimmed.startsWith("HENRIKDEV_API_KEY=")) {
        return trimmed.slice("HENRIKDEV_API_KEY=".length).trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env not found — rely on env var or dev fallback
  }
  return "";
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

let nextId = 1;

export class PythonBridge extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer = "";
  private readonly pending = new Map<number, PendingCall>();
  private readonly callTimeout = 30_000;

  start(): void {
    // In dev, the source backend lives at <projectRoot>/src/backend/main.py and
    // runs via the system Python with the --dev flag (project-local data dir).
    // In a packaged app, spawn the PyInstaller-bundled executable from the
    // resources/python folder (no --dev flag => %APPDATA%\RiotSwitcher).
    let command: string;
    let args: string[];

    if (app.isPackaged) {
      command = join(process.resourcesPath, "python", "main.exe");
      args = [];
    } else {
      const appPath = app.getAppPath();
      const candidate = join(appPath, "src/backend/main.py");
      const scriptPath = process.env.RIOTSWITCHER_BACKEND
        ? process.env.RIOTSWITCHER_BACKEND
        : candidate;

      command = "python";
      args = [scriptPath];
      if (!process.env.RIOTSWITCHER_BACKEND) {
        // Passing --dev tells the backend to use the project-local data dir.
        args.push("--dev");
      }
    }

    this.process = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", HENRIKDEV_API_KEY: loadEnvKey() },
    });

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) console.log(`[python:stderr] ${msg}`);
    });

    this.process.on("exit", (code) => {
      console.log(`[python] exited with code ${code}`);
      this.process = null;
      for (const [, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error(`Python backend exited with code ${code}`));
      }
      this.pending.clear();
    });

    this.process.on("error", (err) => {
      console.error("[python] spawn error:", err.message);
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Python backend stopped"));
    }
    this.pending.clear();
  }

  onEvent(callback: (event: string, params: unknown) => void): void {
    this.on("event", callback);
  }

  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error("Python backend not running"));
        return;
      }

      const id = nextId++;
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Call '${method}' timed out after ${this.callTimeout}ms`));
      }, this.callTimeout);

      this.pending.set(id, { resolve, reject, timeout });

      const message = JSON.stringify({ id, method, params }) + "\n";
      try {
        this.process.stdin.write(message);
      } catch (err) {
        clearTimeout(timeout);
        this.pending.delete(id);
        reject(new Error(`Failed to send '${method}': ${err}`));
        return;
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line);

        if ("id" in parsed && this.pending.has(parsed.id)) {
          const pending = this.pending.get(parsed.id)!;
          this.pending.delete(parsed.id);
          clearTimeout(pending.timeout);

          if (parsed.error) {
            pending.reject(new Error(parsed.error));
          } else {
            pending.resolve(parsed.result);
          }
        } else if ("event" in parsed) {
          this.emit("event", parsed.event, parsed.params);
        }
      } catch {
        console.warn("[python] unparseable line:", line);
      }
    }
  }
}
