import { useCallback, useEffect, useRef, useState } from "react";
import { useIPC } from "./useIPC";

export type LaunchState = "idle" | "launching" | "launched";

export interface LaunchProgress {
  step: string;
  status: string;
  message: string;
  pid?: number;
}

/** Backend result of `launch_profile`. `code` is machine-readable ("valorant_running"). */
export interface LaunchResult {
  ok?: boolean;
  error?: string;
  step?: string;
  code?: string;
  pid?: number;
}

export interface UseProfileLaunch {
  launchState: LaunchState;
  launchingProfile: string | null;
  progress: LaunchProgress | null;
  launch: (name: string) => Promise<LaunchResult | undefined>;
}

export function useProfileLaunch(): UseProfileLaunch {
  const { call, onEvent } = useIPC();
  const [launchState, setLaunchState] = useState<LaunchState>("idle");
  const [launchingProfile, setLaunchingProfile] = useState<string | null>(null);
  const [progress, setProgress] = useState<LaunchProgress | null>(null);
  const launchedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsub = onEvent("profile_switch_progress", (params) => {
      const p = params as LaunchProgress;
      setProgress(p);
      if (p.status === "done" && p.step === "launch") {
        setLaunchState("launched");
        if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
        if (launchedTimerRef.current) clearTimeout(launchedTimerRef.current);
        launchedTimerRef.current = setTimeout(() => {
          setLaunchState("idle");
          setLaunchingProfile(null);
          setProgress(null);
        }, 4000);
      } else if (p.status === "failed") {
        if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
        setLaunchState("idle");
        setLaunchingProfile(null);
        setProgress(null);
      }
    });
    return () => {
      unsub?.();
      if (launchedTimerRef.current) clearTimeout(launchedTimerRef.current);
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
    };
  }, [onEvent]);

  const launch = useCallback(
    async (name: string) => {
      if (launchState !== "idle") return undefined;
      setLaunchState("launching");
      setLaunchingProfile(name);
      setProgress({ step: "start", status: "pending", message: "Killing processes…" });
      if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
      launchTimeoutRef.current = setTimeout(() => {
        setLaunchState("idle");
        setLaunchingProfile(null);
        setProgress({ step: "launch", status: "failed", message: "Launch timed out" });
      }, 30_000);
      try {
        const result = await call<LaunchResult>("launch_profile", { name });
        if (result?.ok === false) {
          const msg = result.error || "Launch failed";
          if (result.code === "valorant_running") {
            // Not a failure to report: the caller opens the "Quit VALORANT?"
            // dialog instead of a toast. Clear the loading state silently.
            if (launchTimeoutRef.current) clearTimeout(launchTimeoutRef.current);
            setLaunchState("idle");
            setLaunchingProfile(null);
            setProgress(null);
            return result;
          }
          setProgress({
            step: result.step || "launch",
            status: "failed",
            message: msg,
          });
          setLaunchState("idle");
        }
        return result;
      } catch (e) {
        setProgress({ step: "launch", status: "failed", message: String(e) });
        setLaunchState("idle");
        return { ok: false, error: String(e) };
      }
    },
    [call, launchState],
  );

  return { launchState, launchingProfile, progress, launch };
}
