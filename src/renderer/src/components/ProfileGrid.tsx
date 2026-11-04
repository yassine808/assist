import type { Profile } from "../types/profile";
import type { LaunchState } from "../hooks/useProfileLaunch";
import ProfileCard from "./ProfileCard";
import SkeletonCard from "./SkeletonCard";

interface Props {
  profiles: Profile[];
  loading: boolean;
  launchState?: LaunchState;
  launchingProfile?: string | null;
  onLaunch: (name: string) => void;
  onDelete: (p: Profile) => void;
  onModifyCard?: (p: Profile) => void;
}

export default function ProfileGrid({
  profiles,
  loading,
  launchState = "idle",
  launchingProfile = null,
  onLaunch,
  onDelete,
  onModifyCard,
}: Readonly<Props>) {
  const activeProfileName = profiles.find((p) => p.is_running)?.profile_name ?? null;

  return (
    <div className="flex flex-wrap gap-x-7 gap-y-8">
      {loading
        ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
        : profiles.map((p, i) => (
            <ProfileCard
              key={p.profile_name}
              index={i}
              profile={p}
              running={p.is_running}
              activeProfileName={activeProfileName}
              launchState={launchingProfile === p.profile_name ? launchState : "idle"}
              onLaunch={onLaunch}
              onDelete={onDelete}
              onModifyCard={onModifyCard}
            />
          ))}
    </div>
  );
}
