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
        await call("launch_profile", { name });
      } catch (e) {
        setProgress({ step: "launch", status: "failed", message: String(e) });
        setLaunching(false);
      }
    },
    [call, launching]
  );

  return { launching, progress, launch };
}
