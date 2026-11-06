import { useCallback, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import ProfileGrid from "../components/ProfileGrid";
import PlayerCardPicker from "../components/PlayerCardPicker";
import DeleteProfileModal from "../components/DeleteProfileModal";
import QuitValorantModal from "../components/QuitValorantModal";
import AddAccountModal from "../components/AddAccountModal";
import { useIPC } from "../hooks/useIPC";
import { useProfileLaunch } from "../hooks/useProfileLaunch";
import { useToast } from "../lib/toast";
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
  const [showAddAccount, setShowAddAccount] = useState(false);
  // VALORANT blocked a launch or a sign-out: offer to quit the game, then
  // retry whatever was pending.
  const [pendingValorant, setPendingValorant] = useState<{ kind: "launch" | "sign-out"; name: string } | null>(null);
  const [quitting, setQuitting] = useState(false);
  const [quitError, setQuitError] = useState("");

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

  const handleDelete = useCallback((p: Profile) => {
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
      toast.show({
        id: "launch",
        kind: "error",
        title: "Launch failed",
        message: progress.message || "Something went wrong",
      });
    } else if (launchState === "launching") {
      toast.update("launch", { message: progress.message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [progress]);

  // A launch that VALORANT blocks is not an error toast: it opens the
  // "Quit VALORANT?" dialog and retries once the game is gone.
  const handleLaunch = useCallback(
    async (name: string) => {
      const result = await launch(name);
      if (result?.ok === false && result.code === "valorant_running") {
        toast.dismiss("launch");
        setQuitError("");
        setPendingValorant({ kind: "launch", name });
      }
    },
    [launch, toast],
  );

  // Exit the Riot Client and clear the live login. The profile itself is kept,
  // so the card stays and switching back signs in again.
  const signOut = useCallback(
    async (name: string) => {
      try {
        const res = await call<{ ok?: boolean; code?: string; error?: string }>("sign_out_profile", { name });
        if (res?.ok === false) {
          if (res.code === "valorant_running") {
            setQuitError("");
            setPendingValorant({ kind: "sign-out", name });
            return;
          }
          toast.show({ kind: "error", title: "Sign out failed", message: res.error || "Something went wrong" });
          return;
        }
        toast.show({ kind: "success", title: "Signed out", message: `${name} is still saved` });
        void load();
      } catch (e) {
        console.error("sign out failed", e);
        toast.show({ kind: "error", title: "Sign out failed", message: String(e) });
      }
    },
    [call, load, toast],
  );

  const doQuitValorant = useCallback(async () => {
    if (!pendingValorant) return;
    setQuitError("");
    setQuitting(true);
    try {
      const res = await call<{ ok?: boolean; error?: string }>("quit_valorant");
      if (res?.ok === false) {
        setQuitError(res.error || "VALORANT is still running");
        return;
      }
      const pending = pendingValorant;
      setPendingValorant(null);
      if (pending.kind === "launch") void launch(pending.name);
      else void signOut(pending.name);
    } catch (e) {
      console.error("quit VALORANT failed", e);
      setQuitError(String(e));
    } finally {
      setQuitting(false);
    }
  }, [pendingValorant, call, launch, signOut]);

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
    [call, load],
  );

  const handleModifyCard = useCallback((p: Profile) => {
    setEditingCard(p);
  }, []);

  // The toolbar itself is sticky (CSS); this only tags it once the grid is
  // actually sliding underneath, so the frosted backdrop appears on scroll and
  // the page stays flat at the top.
  const headRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const head = headRef.current;
    const pane = head?.closest(".view-pane");
    if (!head || !pane) return;
    const sync = () => head.classList.toggle("is-stuck", pane.scrollTop > 4);
    sync();
    pane.addEventListener("scroll", sync, { passive: true });
    return () => pane.removeEventListener("scroll", sync);
  }, []);

  return (
    <div className="px-9 pt-4 pb-10">
      <header ref={headRef} className="profiles-head flex items-center justify-between">
        <h1 className="page-title is-compact">
          Profiles
          {!loading && <span className="count-pill">{profiles.length}</span>}
        </h1>
        <div className="flex items-center gap-2.5">
          {(loading || profiles.length > 0) && (
            <button onClick={() => setShowAddAccount(true)} className="btn-primary h-8 px-4 text-[10px]">
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
        onLaunch={handleLaunch}
        onDelete={handleDelete}
        onModifyCard={handleModifyCard}
        onSignOut={signOut}
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
            Sign in to your Riot account once and RiotSwitcher will <b>save it</b>. After that you can <b>switch</b>{" "}
            between accounts in a single click.
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

      <QuitValorantModal
        open={!!pendingValorant}
        busy={quitting}
        error={quitError}
        action={pendingValorant?.kind ?? "launch"}
        profileName={pendingValorant?.name ?? ""}
        onCancel={() => {
          setPendingValorant(null);
          setQuitError("");
        }}
        onConfirm={() => void doQuitValorant()}
      />

      {editingCard && (
        <PlayerCardPicker
          profileName={editingCard.profile_name}
          currentCardUrl={editingCard.valorant_data?.player_card_bg ?? ""}
          onClose={() => setEditingCard(null)}
          onApplied={() => void load()}
        />
      )}

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
