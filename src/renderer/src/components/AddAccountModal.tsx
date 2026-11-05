import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, LogIn, UserPlus } from "lucide-react";
import { useIPC } from "../hooks/useIPC";
import { useAccountDetection } from "../hooks/useAccountDetection";
import Modal from "./Modal";

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

type StepState = "done" | "active" | "todo";

function Step({ n, state, children }: Readonly<{ n: number; state: StepState; children: React.ReactNode }>) {
  return (
    <li className={`aa-step is-${state}`}>
      <span className="aa-step-n">{state === "done" ? <Check size={12} strokeWidth={3} /> : n}</span>
      <span className="aa-step-t">{children}</span>
    </li>
  );
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
        <div>
          <div className="aa-radar" aria-hidden>
            <span className="aa-radar-ring" /><span className="aa-radar-ring" style={{ animationDelay: "0.9s" }} />
            <span className="aa-radar-core"><LogIn size={22} /></span>
          </div>
          <p className="aa-headline text-center">
            {effectivePhase === "already_added" ? "Already saved — opening the login again…" : "Waiting for you to sign in"}
          </p>
          <ol className="aa-steps">
            <Step n={1} state="done">Riot Client is open</Step>
            <Step n={2} state="active">Sign in with the account you want to add</Step>
            <Step n={3} state="todo">It is saved automatically</Step>
          </ol>
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
