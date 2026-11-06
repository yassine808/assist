import { Power } from "lucide-react";
import Modal from "./Modal";

interface Props {
  open: boolean;
  busy: boolean;
  error: string;
  /** What the user was doing when VALORANT blocked it. */
  action: "launch" | "sign-out";
  profileName: string;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * Confirmation shown instead of the old "Close VALORANT before switching
 * accounts" toast. The backend refuses to touch the game on its own; only this
 * dialog's confirm button reaches `quit_valorant`.
 */
export default function QuitValorantModal({
  open,
  busy,
  error,
  action,
  profileName,
  onCancel,
  onConfirm,
}: Readonly<Props>) {
  const consequence =
    action === "launch" ? (
      <>
        switch to <b>{profileName}</b>
      </>
    ) : (
      <>
        sign out of <b>{profileName}</b>
      </>
    );

  return (
    <Modal
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      tone="danger"
      eyebrow="Confirm"
      title="Quit VALORANT?"
      icon={<Power size={18} />}
      width={430}
      footer={
        <>
          <button
            type="button"
            data-autofocus
            onClick={onCancel}
            disabled={busy}
            className="btn-ghost h-10 px-5 text-[11px]"
          >
            Cancel
          </button>
          <button type="button" onClick={onConfirm} disabled={busy} className="btn-primary h-10 px-6 text-[11px]">
            {busy ? <span className="spinner-icon" /> : <Power size={13} />}
            {busy ? "Closing…" : "Quit VALORANT"}
          </button>
        </>
      }
    >
      <p className="rs-text">VALORANT is running, so RiotSwitcher cannot {consequence} yet.</p>
      <p className="rs-text">Quitting the game ends the current match. Vanguard stays running and is not touched.</p>
      {error && <p className="rs-error">{error}</p>}
    </Modal>
  );
}
