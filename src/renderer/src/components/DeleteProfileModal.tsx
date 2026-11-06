import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import Modal from "./Modal";
import type { Profile } from "../types/profile";

interface Props {
  profile: Profile | null;
  busy: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function DeleteProfileModal({ profile, busy, error, onCancel, onConfirm }: Readonly<Props>) {
  // keep the name on screen while the dialog fades away
  const [shown, setShown] = useState<Profile | null>(profile);
  useEffect(() => {
    if (profile) setShown(profile);
  }, [profile]);

  return (
    <Modal
      open={!!profile}
      onClose={onCancel}
      dismissible={!busy}
      tone="danger"
      eyebrow="Confirm"
      title="Delete profile?"
      icon={<Trash2 size={18} />}
      width={420}
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
            {busy ? <span className="spinner-icon" /> : <Trash2 size={13} />}
            {busy ? "Deleting…" : "Delete"}
          </button>
        </>
      }
    >
      <div className="del-chip" title={shown?.profile_name}>
        <span className="del-chip-dot" />
        <span className="del-chip-name">{shown?.profile_name}</span>
      </div>
      <p className="rs-text">
        This profile and its saved Riot session will be <b>permanently removed</b>. To use the account again you will
        have to sign in and add it back.
      </p>
      {error && <p className="rs-error">{error}</p>}
    </Modal>
  );
}
