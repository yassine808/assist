import { useCallback, useEffect, useState } from "react";
import { useIPC } from "./useIPC";

export interface DetectionProgress {
  status: string;
  message: string;
  display?: string;
  profile_name?: string;
}

export interface UseAccountDetection {
  active: boolean;
  progress: DetectionProgress | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

export function useAccountDetection(): UseAccountDetection {
  const { call, onEvent } = useIPC();
  const [active, setActive] = useState(false);
  const [progress, setProgress] = useState<DetectionProgress | null>(null);

  useEffect(() => {
    const unsub = onEvent("account_detection_progress", (params) => {
      const p = params as DetectionProgress;
      setProgress(p);
      if (p.status === "created" || p.status === "canceled" || p.status === "error") {
        setActive(false);
      }
    });
    return () => {
      unsub?.();
    };
  }, [onEvent]);

  useEffect(() => {
    let mounted = true;
    void call<boolean>("account_detection_state").then((running) => {
      if (mounted) setActive(!!running);
    });
    return () => {
      mounted = false;
    };
  }, [call]);

  useEffect(() => {
    const unsub = onEvent("profile_created", () => {
      setActive(false);
    });
    return () => {
      unsub?.();
    };
  }, [onEvent]);

  const start = useCallback(async () => {
    setActive(true);
    setProgress({ status: "waiting", message: "Opening Riot Client…" });
    try {
      await call("start_account_detection");
    } catch (e) {
      setProgress({ status: "error", message: String(e) });
      setActive(false);
    }
  }, [call]);

  const stop = useCallback(async () => {
    setActive(false);
    try {
      await call("stop_account_detection");
    } catch {
      /* ignore */
    }
    setProgress(null);
  }, [call]);

  return { active, progress, start, stop };
}
