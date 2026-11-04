import { useCallback, useEffect, useRef, useState } from "react";
import { useIPC } from "../hooks/useIPC";
import { useAccountDetection } from "../hooks/useAccountDetection";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onAccountAdded?: () => void;
}

type ModalPhase =
  | "checking"       // checking for an existing live session
  | "opening"        // opening a fresh Riot Client for a new login
  | "waiting"        // waiting for login
  | "already_added"  // detected account is already saved
  | "created"        // profile created successfully
  | "error";         // something went wrong

interface CaptureResult {
  added: boolean;
  reason: string;
  display: string;
  profile?: { profile_name?: string };
  message?: string;
}

export default function AddAccountModal({ open, onClose, onAccountAdded }: Readonly<AddAccountModalProps>) {
  const { call } = useIPC();
  const { active, progress, start, stop } = useAccountDetection();
  const [phase, setPhase] = useState<ModalPhase>("checking");
  const [createdName, setCreatedName] = useState("");
  const prevOpen = useRef(false);
  const skipDetection = useRef(false);

  const checkForAccount = useCallback(async () => {
    setPhase("checking");
    setCreatedName("");
    skipDetection.current = false;

    try {
      const result = await call<CaptureResult>("capture_current_account");
      if (result?.added) {
        // The live session was new, so it has already been saved.
        setCreatedName(result.profile?.profile_name || result.display || "Account");
        setPhase("created");
        onAccountAdded?.();
      } else {
        // Nothing worth capturing: open a fresh client and wait for a login.
        setPhase("opening");
      }
    } catch {
      setPhase("opening");
    }
  }, [call, onAccountAdded]);

  useEffect(() => {
    if (open && !prevOpen.current) {
      void checkForAccount();
      prevOpen.current = true;
    }
    if (!open) {
      prevOpen.current = false;
    }
  }, [open, checkForAccount]);

  // Start detection when phase becomes "opening" — but not if skipDetection is set
  useEffect(() => {
    if (phase === "opening" && !active && !skipDetection.current) {
      void start();
    }
  }, [phase, active, start]);

  // Derive phase from progress — use useMemo to avoid setState in effect
  const phaseFromStatus: Partial<Record<string, ModalPhase>> = {
    waiting: "waiting",
    already_added: "already_added",
    created: "created",
    // A login timeout must surface as an error, not leave the modal spinning.
    canceled: "error",
    error: "error",
  };
  const progressPhase = progress?.status ? (phaseFromStatus[progress.status] ?? null) : null;

  const effectivePhase = progressPhase ?? phase;

  const handleClose = useCallback(async () => {
    skipDetection.current = true;
    await stop();
    onClose();
  }, [stop, onClose]);

  const handleDone = useCallback(() => {
    onAccountAdded?.();
    onClose();
  }, [onAccountAdded, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleClose} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleClose(); }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      <div
        className="relative w-[380px] rounded-xl bg-[#12161f] border border-white/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.stopPropagation()}
        style={{ animation: "fadeIn 0.2s ease-out" }}
      >
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-white/40 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>

        <h2 className="text-white font-bold text-base mb-1">Add Account</h2>

        {effectivePhase === "checking" && (
          <div className="flex items-center gap-2 py-4 text-white/60 text-sm">
            <span className="spinner-icon" /> Checking for logged-in account…
          </div>
        )}

        {(effectivePhase === "opening" || effectivePhase === "waiting" || effectivePhase === "already_added") && (
          <div className="flex items-start gap-2 py-4 text-white/60 text-sm">
            <span className="spinner-icon mt-0.5" />
            <div>
              {effectivePhase === "opening" && "Waiting for login…"}
              {effectivePhase === "waiting" && "Waiting for login…"}
              {effectivePhase === "already_added" && "Account already added. Opening the login screen again…"}
              {effectivePhase !== "already_added" && (
                <p className="text-white/40 text-xs mt-1">
                  The Riot Client is open. Sign in with the account you want to add — it is saved automatically.
                </p>
              )}
            </div>
          </div>
        )}

        {effectivePhase === "created" && (
          <div className="py-2 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <p className="text-white font-semibold text-sm mb-1">Account Added</p>
            <p className="text-white/50 text-xs mb-4">
              {createdName || progress?.profile_name || progress?.display || "Account"} saved
            </p>
            <button
              onClick={handleDone}
              className="w-full h-9 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {effectivePhase === "error" && (
          <div className="py-2 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-red-500/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#f87171" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>
            </div>
            <p className="text-white font-semibold text-sm mb-1">Something went wrong</p>
            <p className="text-white/50 text-xs mb-4">{progress?.message ?? "Unknown error"}</p>
            <div className="flex gap-2">
              <button
                onClick={handleClose}
                className="flex-1 h-9 rounded-md text-xs font-semibold text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => { setPhase("opening"); }}
                className="flex-1 h-9 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
