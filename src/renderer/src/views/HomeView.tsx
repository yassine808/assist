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
  const { launch, launchState, launchingProfile } = useProfileLaunch();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [editingCard, setEditingCard] = useState<Profile | null>(null);
  const [closing, setClosing] = useState(false);
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

  const handlePlay = useCallback(
    (p: Profile) => {
      void launch(p.profile_name);
    },
    [launch]
  );

  const handleDelete = useCallback(async (p: Profile) => {
    setConfirmDelete(p);
  }, []);

  const doDelete = useCallback(async () => {
    if (!confirmDelete) return;
    try {
      await call("delete_profile", { name: confirmDelete.profile_name });
      setConfirmDelete(null);
      void load();
    } catch (e) {
      console.error("delete failed", e);
      setConfirmDelete(null);
    }
  }, [confirmDelete, call, load]);

  const handleModifyCard = useCallback((p: Profile) => {
    setEditingCard(p);
  }, []);

  const handleClose = useCallback(async () => {
    setClosing(true);
    try {
      await call("close_all");
    } catch (e) {
      console.error("close failed", e);
      setClosing(false);
    }
  }, [call]);

  useEffect(() => {
    const unsub = onEvent("close_complete", () => {
      setClosing(false);
      void load();
    });
    return () => { unsub?.(); };
  }, [onEvent, load]);

  const handleReorder = useCallback(
    async (names: string[]) => {
      try {
        const result = await call<Profile[]>("reorder_profiles", { names });
        if (result) setProfiles(result);
      } catch (e) {
        console.error("reorder failed", e);
        void load();
      }
    },
    [call, load]
  );

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Profiles</h1>
          <p className="text-xs text-white/40 mt-0.5">
            Switch between Riot accounts instantly
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleClose}
            disabled={closing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white/70 bg-white/[0.06] hover:bg-red-500/20 border border-white/[0.08] hover:text-red-400 transition-all disabled:opacity-40"
          >
            {closing ? (
              <><span className="spinner-icon" /> Closing…</>
            ) : (
              <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg> Close Game</>
            )}
          </button>
          <button
            onClick={() => setShowImportExport(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-white/70 bg-white/[0.06] hover:bg-white/[0.1] border border-white/[0.08] hover:text-white transition-all"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Import / Export
          </button>
          <button
            onClick={() => setShowAddAccount(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
          >
            <Plus size={13} /> Add Account
          </button>
        </div>
      </div>

      <ProfileGrid
        profiles={profiles}
        loading={loading}
        launchState={launchState}
        launchingProfile={launchingProfile}
        onPlay={handlePlay}
        onDelete={handleDelete}
        onReorder={handleReorder}
        onModifyCard={handleModifyCard}
      />

      {!loading && profiles.length === 0 && (
        <div className="mt-16 flex flex-col items-center text-center">
          <p className="text-white/50 text-sm">
            No profiles yet. Click{" "}
            <span className="text-riot-red">Add Account</span> to create your
            first profile.
          </p>
        </div>
      )}

      {confirmDelete && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/60"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="w-[340px] rounded-lg bg-bg-card border border-white/10 p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-white font-bold text-base mb-2">
              Delete profile?
            </h3>
            <p className="text-sm text-white/60 mb-5">
              "{confirmDelete.profile_name}" will be permanently removed. Saved
              session data for this profile will be deleted.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                onClick={() => void doDelete()}
                className="px-3 py-1.5 rounded-md text-xs font-semibold text-white bg-riot-red hover:bg-riot-red/90"
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
