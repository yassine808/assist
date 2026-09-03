import { useCallback, useEffect, useState } from "react";
import { useIPC } from "./useIPC";

export interface LaunchProgress {
  step: string;
  status: string;
  message: string;
  pid?: number;
}

export interface UseProfileLaunch {
  launching: boolean;
  progress: LaunchProgress | null;
  launch: (name: string) => Promise<void>;
}

export function useProfileLaunch(): UseProfileLaunch {
  const { call, onEvent } = useIPC();
  const [launching, setLaunching] = useState(false);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);

  useEffect(() => {
    const unsub = onEvent("profile_switch_progress", (params) => {
      const p = params as LaunchProgress;
      setProgress(p);
      if (p.status === "done" || p.status === "failed") {
        setLaunching(false);
        if (p.status === "done") {
          window.setTimeout(() => setProgress(null), 2500);
        }
      }
    });
    return () => {
      unsub?.();
    };
  }, [onEvent]);

  const launch = useCallback(
    async (name: string) => {
      if (launching) return;
      setLaunching(true);
      setProgress({ step: "start", status: "pending", message: "Starting…" });
      try {
        const result = await call<{
          ok?: boolean;
          error?: string;
          step?: string;
          pid?: number;
        }>("launch_profile", { name });
        if (result && result.ok === false) {
          const msg = result.error || "Launch failed";
          setProgress({
            step: result.step || "launch",
            status: "failed",
            message: msg,
          });
          setLaunching(false);
        }
      } catch (e) {
        setProgress({ step: "launch", status: "failed", message: String(e) });
        setLaunching(false);
      }
    },
    [call, launching]
  );

  return { launching, progress, launch };
}
