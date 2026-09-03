import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import ProfileGrid from "../components/ProfileGrid";
import { useIPC } from "../hooks/useIPC";
import { useProfileLaunch } from "../hooks/useProfileLaunch";
import type { Profile } from "../types/profile";

export default function HomeView() {
  const { call, onEvent } = useIPC();
  const { launch } = useProfileLaunch();
  const navigate = useNavigate();

  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState<Profile | null>(null);

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

  useEffect(() => {
    void load();
  }, [load]);

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

  const handleEdit = useCallback(
    (p: Profile) => {
      navigate(`/settings?profile=${encodeURIComponent(p.profile_name)}`);
    },
    [navigate]
  );

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
            onClick={() => navigate("/add-account")}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
          >
            <Plus size={13} /> Add Account
          </button>
        </div>
      </div>

      <ProfileGrid
        profiles={profiles}
        loading={loading}
        onPlay={handlePlay}
        onDelete={handleDelete}
        onEdit={handleEdit}
        onReorder={handleReorder}
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
    </div>
  );
}
