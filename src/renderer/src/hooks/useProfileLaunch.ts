import { useCallback, useEffect, useRef, useState } from "react";
import { useIPC } from "./useIPC";

export type LaunchState = "idle" | "launching" | "launched";

export interface LaunchProgress {
  step: string;
  status: string;
  message: string;
  pid?: number;
}

export interface UseProfileLaunch {
  launchState: LaunchState;
  launchingProfile: string | null;
  progress: LaunchProgress | null;
  launch: (name: string) => Promise<void>;
}

export function useProfileLaunch(): UseProfileLaunch {
  const { call, onEvent } = useIPC();
  const [launchState, setLaunchState] = useState<LaunchState>("idle");
  const [launchingProfile, setLaunchingProfile] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const launchedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onEvent("profile_switch_progress", (params) => {
      const p = params as LaunchProgress;
      setProgress(p);
      if (p.status === "done" && p.step === "launch") {
        setLaunchState("launched");
        if (launchedTimerRef.current) clearTimeout(launchedTimerRef.current);
        launchedTimerRef.current = setTimeout(() => {
          setLaunchState("idle");
          setLaunchingProfile(null);
          setProgress(null);
        }, 4000);
      } else if (p.status === "failed") {
        setLaunchState("idle");
        setLaunchingProfile(null);
      }
    });
    return () => {
      unsub?.();
      if (launchedTimerRef.current) clearTimeout(launchedTimerRef.current);
    };
  }, [onEvent]);

  const launch = useCallback(
    async (name: string) => {
      if (launchState !== "idle") return;
      setLaunchState("launching");
      setLaunchingProfile(name);
      setProgress({ step: "start", status: "pending", message: "Killing processes…" });
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
          setLaunchState("idle");
        }
      } catch (e) {
        setProgress({ step: "launch", status: "failed", message: String(e) });
        setLaunchState("idle");
      }
    },
    [call, launchState]
  );

  return { launchState, launchingProfile, progress, launch };
}
