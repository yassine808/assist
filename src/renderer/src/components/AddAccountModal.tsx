import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, UserPlus } from "lucide-react";
import { useIPC } from "../hooks/useIPC";
import { useAccountDetection } from "../hooks/useAccountDetection";
import Modal from "./Modal";
import signInArt from "../assets/stay-signed-in.png";

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

  // Derive phase from progress
  const phaseFromStatus: Partial<Record<string, ModalPhase>> = {
    closing: "opening",
    opening: "opening",
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

  const name = createdName || progress?.profile_name || progress?.display || "Account";
  const waitingForLogin = effectivePhase === "opening" || effectivePhase === "waiting" || effectivePhase === "already_added";
  const finished = effectivePhase === "created";
  const failed = effectivePhase === "error";
  const clientReady = effectivePhase === "waiting";
  const step1Text = clientReady
    ? "Riot Client ready"
    : progress?.status === "closing"
      ? "Closing Riot Client\u2026"
      : "Opening Riot Client\u2026";

  let footer = (
    <button type="button" onClick={() => void handleClose()} className="btn-ghost h-10 px-5 text-[11px]">Cancel</button>
  );
  if (finished) {
    footer = <button type="button" data-autofocus onClick={handleDone} className="btn-primary h-10 px-8 text-[11px]"><Check size={14} strokeWidth={3} /> Done</button>;
  } else if (failed) {
    footer = (
      <>
        <button type="button" onClick={() => void handleClose()} className="btn-ghost h-10 px-5 text-[11px]">Close</button>
        <button type="button" data-autofocus onClick={() => setPhase("opening")} className="btn-primary h-10 px-6 text-[11px]">Try again</button>
      </>
    );
  }

  return (
    <Modal
      open={open}
      onClose={() => void handleClose()}
      tone={failed ? "danger" : finished ? "success" : "default"}
      eyebrow="New profile"
      title={finished ? "Account added" : failed ? "Something went wrong" : "Add account"}
      icon={finished ? <Check size={18} strokeWidth={2.6} /> : failed ? <AlertTriangle size={18} /> : <UserPlus size={18} />}
      width={440}
      footer={footer}
    >
      {effectivePhase === "checking" && (
        <div className="aa-center">
          <span className="aa-ring"><span className="spinner-icon" /></span>
          <p className="aa-headline">Checking for a signed-in account…</p>
          <p className="rs-text-sm">If you are already logged in to Riot, it will be saved right away.</p>
        </div>
      )}

      {waitingForLogin && (
        <div className="aa-center">
          <div className="aa-signin-figure">
            <img
              className="aa-signin-art"
              src={signInArt}
              alt="Riot sign-in window with the Stay signed in box ticked"
            />
            <svg className="aa-signin-arrow" viewBox="0 0 348 442" fill="none" aria-hidden="true" focusable="false">
              <path
                className="aa-arrow-line"
                d="M318 434C280 440 215 434 175 404"
                stroke="currentColor"
                strokeWidth="5.5"
                strokeLinecap="round"
              />
              <path
                className="aa-arrow-head"
                d="M186.3 404.6 172 402 178.5 415Z"
                fill="currentColor"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <div className="aa-signin-caption">
            <span className="aa-signin-caption-label">
              <span className="aa-signin-caption-tick" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.2 4.2L19 7.5" />
                </svg>
              </span>
              Stay signed in:
            </span>
            <span className="aa-signin-caption-text">
              Tick it before you finish the login. The account is saved automatically.
            </span>
          </div>
          <div className="aa-signin-status">
            <span className={`aa-signin-step ${clientReady ? "is-done" : "is-active"}`}>
              <span className="aa-step-ico">
                {clientReady ? (
                  <svg className="aa-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path className="aa-draw" d="M4 12.5l5 5L20 6.5" />
                  </svg>
                ) : (
                  <span className="aa-orb" aria-hidden="true" />
                )}
              </span>
              {step1Text}
            </span>
            <span className={`aa-signin-step aa-listening ${clientReady ? "is-active" : ""}`}>
              <span className="aa-step-ico">
                <svg className="aa-ico aa-ico-radar" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
                  <path d="M7.9 16.1a5.8 5.8 0 0 1 0-8.2" />
                  <path d="M16.1 7.9a5.8 5.8 0 0 1 0 8.2" />
                  <path d="M5.1 18.9a9.8 9.8 0 0 1 0-13.8" opacity=".5" />
                  <path d="M18.9 5.1a9.8 9.8 0 0 1 0 13.8" opacity=".5" />
                </svg>
                <span className="aa-ico-ping" aria-hidden="true" />
              </span>
              Waiting for login
            </span>
          </div>
        </div>
      )}

      {finished && (
        <div className="aa-center">
          <span className="aa-success"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path className="toast-check" d="M5 12.5l4.2 4.2L19 7.5" /></svg></span>
          <div className="del-chip is-ok" title={name}><span className="del-chip-dot" /><span className="del-chip-name">{name}</span></div>
          <p className="rs-text-sm">is ready. Pick it from the list and press START to switch.</p>
        </div>
      )}

      {failed && (
        <div className="aa-center">
          <p className="rs-text">{progress?.message ?? "Unknown error"}</p>
        </div>
      )}
    </Modal>
  );
}
