import { useCallback, useEffect, useRef, useState } from "react";
import { useIPC } from "../hooks/useIPC";
import { useAccountDetection, type DetectionProgress } from "../hooks/useAccountDetection";

interface AddAccountModalProps {
  open: boolean;
  onClose: () => void;
  onAccountAdded?: () => void;
}

type ModalPhase =
  | "checking"       // checking for existing logged-in account
  | "suggest"        // found a new account already logged in
  | "opening"        // killing + launching client
  | "waiting"        // waiting for login
  | "confirm_save"   // new account detected, ask to save
  | "already_added"  // detected account is already saved
  | "created"        // profile created successfully
  | "error";         // something went wrong

export default function AddAccountModal({ open, onClose, onAccountAdded }: AddAccountModalProps) {
  const { call } = useIPC();
  const { active, progress, start, stop, confirmSave } = useAccountDetection();
  const [phase, setPhase] = useState<ModalPhase>("checking");
  const [suggestedAccount, setSuggestedAccount] = useState<{ display: string; account: Record<string, unknown> } | null>(null);
  const hasChecked = useRef(false);

  // Check for existing account on open
  useEffect(() => {
    if (!open) {
      setPhase("checking");
      setSuggestedAccount(null);
      hasChecked.current = false;
      return;
    }
    if (hasChecked.current) return;
    hasChecked.current = true;

    let mounted = true;
    void call<{ found: boolean; display: string; is_new: boolean; account: Record<string, unknown> }>("check_current_account")
      .then((result) => {
        if (!mounted) return;
        if (result?.found && result.is_new) {
          setSuggestedAccount({ display: result.display, account: result.account });
          setPhase("suggest");
        } else {
          setPhase("opening");
        }
      })
      .catch(() => {
        if (mounted) setPhase("opening");
      });
    return () => { mounted = false; };
  }, [open, call]);

  // Start detection when phase becomes "opening"
  useEffect(() => {
    if (phase === "opening" && !active) {
      void start();
    }
  }, [phase, active, start]);

  // Track detection progress
  useEffect(() => {
    if (!progress) return;
    const s = progress.status;
    if (s === "waiting") setPhase("waiting");
    else if (s === "confirm_save") setPhase("confirm_save");
    else if (s === "already_added") setPhase("already_added");
    else if (s === "created") setPhase("created");
    else if (s === "error") setPhase("error");
  }, [progress]);

  const handleAddSuggested = useCallback(async () => {
    if (!suggestedAccount) return;
    try {
      setPhase("opening");
      await call("create_profile", {
        profile_name: suggestedAccount.display,
        valorant_puuid: suggestedAccount.account.puuid as string,
        valorant_region: suggestedAccount.account.riot_region as string,
        valorant_in_game_name: suggestedAccount.display,
      });
      setPhase("created");
      onAccountAdded?.();
    } catch {
      setPhase("error");
    }
  }, [call, suggestedAccount, onAccountAdded]);

  const handleDeclineSuggested = useCallback(() => {
    setSuggestedAccount(null);
    setPhase("opening");
  }, []);

  const handleConfirmSave = useCallback(async (accept: boolean) => {
    await confirmSave(accept);
  }, [confirmSave]);

  const handleClose = useCallback(async () => {
    await stop();
    onClose();
  }, [stop, onClose]);

  const handleDone = useCallback(() => {
    onAccountAdded?.();
    onClose();
  }, [onAccountAdded, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleClose}>
      {/* Blurred backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative w-[380px] rounded-xl bg-[#12161f] border border-white/10 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "fadeIn 0.2s ease-out" }}
      >
        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-3 text-white/40 hover:text-white transition-colors"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
        </button>

        <h2 className="text-white font-bold text-base mb-1">Add Account</h2>

        {/* Phase: checking */}
        {phase === "checking" && (
          <div className="flex items-center gap-2 py-4 text-white/60 text-sm">
            <span className="spinner-icon" /> Checking for logged-in account…
          </div>
        )}

        {/* Phase: suggest */}
        {phase === "suggest" && suggestedAccount && (
          <div className="py-2">
            <p className="text-white/60 text-sm mb-3">
              New account detected in Riot Client:
            </p>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 mb-4">
              <div className="w-8 h-8 rounded-full bg-riot-red/20 flex items-center justify-center text-riot-red text-sm font-bold">
                {suggestedAccount.display.charAt(0).toUpperCase()}
              </div>
              <span className="text-white font-semibold text-sm">{suggestedAccount.display}</span>
            </div>
            <p className="text-white/50 text-xs mb-4">
              Would you like to add this account?
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleDeclineSuggested}
                className="flex-1 h-9 rounded-md text-xs font-semibold text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              >
                Switch Account
              </button>
              <button
                onClick={() => void handleAddSuggested()}
                className="flex-1 h-9 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
              >
                Add Account
              </button>
            </div>
          </div>
        )}

        {/* Phase: opening / waiting / already_added */}
        {(phase === "opening" || phase === "waiting" || phase === "already_added") && (
          <div className="flex items-center gap-2 py-4 text-white/60 text-sm">
            <span className="spinner-icon" />
            {phase === "opening" && "Opening Riot Client…"}
            {phase === "waiting" && "Waiting for login…"}
            {phase === "already_added" && "Account already added. Launching again…"}
          </div>
        )}

        {/* Phase: confirm_save */}
        {phase === "confirm_save" && (
          <div className="py-2">
            <p className="text-white/60 text-sm mb-3">New account detected:</p>
            <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 mb-4">
              <div className="w-8 h-8 rounded-full bg-riot-red/20 flex items-center justify-center text-riot-red text-sm font-bold">
                {(progress?.display ?? "?").charAt(0).toUpperCase()}
              </div>
              <span className="text-white font-semibold text-sm">{progress?.display ?? "Unknown"}</span>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleConfirmSave(false)}
                className="flex-1 h-9 rounded-md text-xs font-semibold text-white/70 bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              >
                Skip
              </button>
              <button
                onClick={() => void handleConfirmSave(true)}
                className="flex-1 h-9 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
              >
                Save Profile
              </button>
            </div>
          </div>
        )}

        {/* Phase: created */}
        {phase === "created" && (
          <div className="py-2 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <p className="text-white font-semibold text-sm mb-1">Profile Created</p>
            <p className="text-white/50 text-xs mb-4">{progress?.profile_name ?? "Account"}</p>
            <button
              onClick={handleDone}
              className="w-full h-9 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
            >
              Done
            </button>
          </div>
        )}

        {/* Phase: error */}
        {phase === "error" && (
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
