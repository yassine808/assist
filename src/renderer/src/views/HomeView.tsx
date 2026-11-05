import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import ProfileGrid from "../components/ProfileGrid";
import PlayerCardPicker from "../components/PlayerCardPicker";
import ImportExportModal from "../components/ImportExportModal";
import DeleteProfileModal from "../components/DeleteProfileModal";
import AddAccountModal from "../components/AddAccountModal";
import { useIPC } from "../hooks/useIPC";
import { useProfileLaunch } from "../hooks/useProfileLaunch";
import { useToast } from "../components/Toast";
import type { Profile } from "../types/profile";

export default function HomeView() {
  const { call, onEvent } = useIPC();
  const { launchState, launchingProfile, progress, launch } = useProfileLaunch();
  const toast = useToast();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
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
    setDeleting(true);
    try {
      await call("delete_profile", { name: confirmDelete.profile_name });
      toast.show({ kind: "success", title: "Profile deleted", message: confirmDelete.profile_name });
      setConfirmDelete(null);
      void load();
    } catch (e) {
      console.error("delete failed", e);
      setDeleteError(String(e));
      toast.show({ kind: "error", title: "Delete failed", message: String(e) });
    } finally {
      setDeleting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmDelete, call, load]);

  // One toast follows a launch from "Launching…" to success / failure.
  useEffect(() => {
    if (launchState === "launching" && launchingProfile) {
      toast.show({
        id: "launch",
        kind: "loading",
        title: `Launching ${launchingProfile}`,
        message: progress?.message ?? "Starting…",
      });
    } else if (launchState === "launched" && launchingProfile) {
      toast.show({ id: "launch", kind: "success", title: "Launched", message: `${launchingProfile} is ready` });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchState, launchingProfile]);

  useEffect(() => {
    if (!progress) return;
    if (progress.status === "failed") {
      toast.show({ id: "launch", kind: "error", title: "Launch failed", message: progress.message || "Something went wrong" });
    } else if (launchState === "launching") {
      toast.update("launch", { message: progress.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  const handleReorder = useCallback(
    async (names: string[]) => {
      // optimistic: show the new order immediately, then persist it
      setProfiles((prev) => {
        const byName = new Map(prev.map((p) => [p.profile_name, p]));
        const ordered = names.map((n) => byName.get(n)).filter((p): p is Profile => !!p);
        return [...ordered, ...prev.filter((p) => !names.includes(p.profile_name))];
      });
      try {
        await call("reorder_profiles", { names });
      } catch (e) {
        console.error("reorder failed", e);
        toast.show({ kind: "error", title: "Couldn't save order", message: String(e) });
        void load();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [call, load]
  );

  const handleModifyCard = useCallback((p: Profile) => {
    setEditingCard(p);
  }, []);

  return (
    <div className="px-9 py-8">
      <header className="flex items-end justify-between mb-9 pb-5 border-b border-white/[0.06]">
        <div>
          <h1 className="page-title">
            Profiles
            {!loading && <span className="count-pill">{profiles.length}</span>}
          </h1>
        </div>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowImportExport(true)}
            className="btn-ghost h-9 px-4 text-[11px]"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>
            Import / Export
          </button>
          {(loading || profiles.length > 0) && (
            <button
              onClick={() => setShowAddAccount(true)}
              className="btn-primary h-9 px-5 text-[11px]"
            >
              <Plus size={14} strokeWidth={3} /> Add Account
            </button>
          )}
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
        onReorder={(names) => void handleReorder(names)}
      />

      {!loading && profiles.length === 0 && (
        <div className="empty-hero">
          <div className="empty-add-wrap">
            <button type="button" className="empty-add" onClick={() => setShowAddAccount(true)}>
              <Plus size={64} strokeWidth={2} className="empty-add-plus" />
              <span className="empty-add-label">Add account</span>
            </button>
          </div>
          <p className="empty-hint">
            Sign in to your Riot account once and RiotSwitcher will <b>save it</b>.
            After that you can <b>switch</b> between accounts in a single click.
          </p>
        </div>
      )}

      <DeleteProfileModal
        profile={confirmDelete}
        busy={deleting}
        error={deleteError}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void doDelete()}
      />

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
        onAccountAdded={() => {
          toast.show({ id: "account-added", kind: "success", title: "Account added", message: "Profile saved" });
          void load();
        }}
      />
    </div>
  );
}
