import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import ProfileGrid from "../components/ProfileGrid";
import PlayerCardPicker from "../components/PlayerCardPicker";
import ImportExportModal from "../components/ImportExportModal";
import AddAccountModal from "../components/AddAccountModal";
import { useIPC } from "../hooks/useIPC";
import { useProfileLaunch } from "../hooks/useProfileLaunch";
import type { Profile } from "../types/profile";

export default function HomeView() {
  const { call, onEvent } = useIPC();
  const { launchState, launchingProfile, launch } = useProfileLaunch();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [editingCard, setEditingCard] = useState<Profile | null>(null);
  const [showImportExport, setShowImportExport] = useState(false);
  const [showAddAccount, setShowAddAccount] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await call<Profile[]>("get_profiles");
      setProfiles(result ?? []);
    } catch (e) {
      console.error("load profiles failed", e);
    } finally {
      setLoading(false);
    }
  }, [call]);

  // Load on mount — setProfiles/setLoading are the intended side effects of an async data fetch
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const unsub = onEvent("valorant_data_updated", (params) => {
      const name = (params as { profile_name?: string })?.profile_name;
      if (name) void load();
    });
    const unsubStatus = onEvent("riot_client_status", () => void load());
    const unsubCreated = onEvent("profile_created", () => void load());
    return () => {
      unsub();
      unsubStatus();
      unsubCreated();
    };
  }, [onEvent, load]);

  const handleDelete = useCallback(async (p: Profile) => {
    setDeleteError("");
    setConfirmDelete(p);
  }, []);

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    setDeleteError("");
    try {
      await call("delete_profile", { name: confirmDelete.profile_name });
      setConfirmDelete(null);
      void load();
    } catch (e) {
      console.error("delete failed", e);
      setDeleteError(String(e));
    }
  }, [confirmDelete, call, load]);

  const handleModifyCard = useCallback((p: Profile) => {
    setEditingCard(p);
  }, []);

  return (
    <div className="px-9 py-8">
      <header className="flex items-end justify-between mb-9 pb-5 border-b border-white/[0.06]">
        <div>
          <div className="page-eyebrow mb-2.5">Account manager</div>
          <h1 className="page-title">
            Profiles
            {!loading && <span className="count-pill">{profiles.length}</span>}
          </h1>
          <p className="page-sub mt-2">Switch between Riot accounts instantly</p>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowImportExport(true)}
            className="btn-ghost h-9 px-4 text-[11px]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Import / Export
          </button>
          <button
            onClick={() => setShowAddAccount(true)}
            className="btn-primary h-9 px-5 text-[11px]"
          >
            <Plus size={14} strokeWidth={3} /> Add Account
          </button>
        </div>
      </header>

      <ProfileGrid
        profiles={profiles}
        loading={loading}
        launchState={launchState}
        launchingProfile={launchingProfile}
        onLaunch={launch}
        onDelete={handleDelete}
        onModifyCard={handleModifyCard}
      />

      {!loading && profiles.length === 0 && (
        <div className="empty-state">
          <p className="text-white/80 text-base font-semibold tracking-wide">No profiles yet</p>
          <p className="text-white/45 text-sm mb-4">Add your first Riot account to start switching.</p>
          <button onClick={() => setShowAddAccount(true)} className="btn-primary h-9 px-5 text-[11px]">
            <Plus size={14} strokeWidth={3} /> Add Account
          </button>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 backdrop-blur-[2px]"
          onClick={() => setConfirmDelete(null)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setConfirmDelete(null); }}
          role="button"
          tabIndex={0}
        >
          <div
            className="modal-panel w-[360px] p-6"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            role="button"
            tabIndex={0}
          >
            <h3 className="text-white font-bold text-base tracking-wide uppercase mb-2">
              Delete profile?
            </h3>
            <p className="text-sm text-white/60 mb-5">
              "{confirmDelete.profile_name}" will be permanently removed. Saved
              session data for this profile will be deleted.
            </p>
            {deleteError && (
              <p className="text-xs text-red-400 mb-3">{deleteError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="btn-ghost h-9 px-4 text-[11px]"
              >
                Cancel
              </button>
              <button
                onClick={() => void doDelete()}
                className="btn-primary h-9 px-5 text-[11px]"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {editingCard && (
        <PlayerCardPicker
          profileName={editingCard.profile_name}
          currentCardUrl={editingCard.valorant_data?.player_card_bg ?? ""}
          onClose={() => setEditingCard(null)}
          onApplied={() => void load()}
        />
      )}

      <ImportExportModal
        open={showImportExport}
        onClose={() => setShowImportExport(false)}
        onImported={() => void load()}
      />

      <AddAccountModal
        open={showAddAccount}
        onClose={() => setShowAddAccount(false)}
        onAccountAdded={() => void load()}
      />
    </div>
  );
}
