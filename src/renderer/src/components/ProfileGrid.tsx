import type { Profile } from "../types/profile";
import type { LaunchState } from "../hooks/useProfileLaunch";
import ProfileCard from "./ProfileCard";
import SkeletonCard from "./SkeletonCard";

interface Props {
  profiles: Profile[];
  loading: boolean;
  launchState?: LaunchState;
  launchingProfile?: string | null;
  onPlay: (p: Profile) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

export default function ProfileGrid({
  profiles,
  loading,
  launchState = "idle",
  launchingProfile = null,
  onPlay,
  onDelete,
  onModifyCard,
}: Readonly<Props>) {
  return (
    <div className="flex flex-wrap gap-5">
      {loading
        ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        : profiles.map((p) => (
            <div key={p.profile_name}>
              <ProfileCard
                profile={p}
                running={p.is_running}
                launchState={launchingProfile === p.profile_name ? launchState : "idle"}
                onPlay={onPlay}
                onDelete={onDelete}
                onModifyCard={onModifyCard}
              />
            </div>
          ))}
    </div>
  );
}
