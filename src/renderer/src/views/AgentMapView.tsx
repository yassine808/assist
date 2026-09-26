import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Map as MapIcon } from "lucide-react";
import { SettingToggle } from "../components/SettingToggle";
import { useIPC } from "../hooks/useIPC";
import type { MapStat, Profile, ValorantMap } from "../types/profile";

const REFRESH_EVENT = "valorant_data_updated";

/** 0-100 winrate mapped to the red→green ramp used across the app. */
function winrateTone(winrate: number): string {
  if (winrate >= 60) return "text-emerald-400";
  if (winrate >= 50) return "text-riot-red";
  return "text-white/45";
}

export default function AgentMapView() {
  const { call, onEvent } = useIPC();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [maps, setMaps] = useState<ValorantMap[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    void call<Record<string, unknown>>("get_config")
      .then((cfg) => setEnabled(Boolean(cfg?.PerMapStats ?? true)))
      .catch(() => undefined);
    void call<ValorantMap[]>("get_valorant_maps")
      .then((m) => setMaps(m ?? []))
      .catch(() => undefined);
    void call<Profile[]>("get_profiles")
      .then((p) => {
        const list = p ?? [];
        setProfiles(list);
        setSelected((prev) => {
          // The dropdown only lists profiles bound to a VALORANT account, so
          // only ever select one of those or the select shows no match.
          const usable = list.filter((x) => Boolean(x.valorant_puuid));
          if (prev && usable.some((x) => x.profile_name === prev)) return prev;
          const withData = usable.find(
            (x) => (x.valorant_data?.map_stats?.length ?? 0) > 0
          );
          return withData?.profile_name ?? usable[0]?.profile_name ?? "";
        });
        setLoading(false);
      })
      .catch(() => {
        // A rejected call means the backend is unreachable, which is not the
        // same as "no profiles" — do not leave a misleading empty state.
        setError("Could not reach the backend. Is it still starting up?");
        setLoading(false);
      });
  }, [call]);

  const profile = useMemo(
    () => profiles.find((p) => p.profile_name === selected),
    [profiles, selected]
  );

  const mapStats: MapStat[] = useMemo(
    () => (enabled ? profile?.valorant_data?.map_stats ?? [] : []),
    [enabled, profile]
  );

  const splashFor = useCallback(
    (mapName: string) => maps.find((m) => m.name === mapName)?.splash ?? "",
    [maps]
  );

  const loadProfiles = useCallback(async () => {
    const list = (await call<Profile[]>("get_profiles")) ?? [];
    setProfiles(list);
  }, [call]);

  // The backend refreshes on a timer, so keep the page in sync with it.
  useEffect(() => {
    const off = onEvent(REFRESH_EVENT, () => {
      void loadProfiles();
    });
    return off;
  }, [onEvent, loadProfiles]);

  const handleToggle = useCallback(
    (value: boolean) => {
      setEnabled(value);
      void call("set_config", { key: "PerMapStats", value });
      // Turning it on only takes effect on the next backend fetch, so ask for
      // one immediately instead of leaving the page empty until the timer.
      if (value && selected) {
        setRefreshing(true);
        void call("refresh_valorant", { name: selected })
          .catch(() => undefined)
          .finally(() => setRefreshing(false));
      }
    },
    [call, selected]
  );

  const handleRefresh = useCallback(() => {
    if (!selected) return;
    setRefreshing(true);
    void call("refresh_valorant", { name: selected })
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [call, selected]);

  const eligible = profiles.filter((p) => Boolean(p.valorant_puuid));

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold text-white">Agent Map</h1>
          <p className="text-xs text-white/40 mt-1">
            Per-map agent winrates from your recent competitive matches
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="h-8 px-2 rounded-md bg-bg-card border border-white/10 text-white text-xs
                       focus:outline-none focus:border-riot-red/50"
            aria-label="Profile"
          >
            {eligible.length === 0 && <option value="">No profiles linked</option>}
            {eligible.map((p) => (
              <option key={p.profile_name} value={p.profile_name}>
                {p.profile_name}
              </option>
            ))}
          </select>
          <button
            onClick={handleRefresh}
            disabled={!selected || refreshing}
            className="h-8 px-3 rounded-md text-xs font-semibold text-black bg-riot-red
                       hover:bg-riot-red/90 disabled:opacity-40 disabled:cursor-not-allowed
                       transition-colors inline-flex items-center gap-1.5"
          >
            <RefreshCw size={12} className={refreshing ? "animate-spin" : undefined} />
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
        </div>
      </div>

      <section className="view-card rounded-md bg-bg-card border border-white/10 p-4 mb-4
                         transition-[border-color,box-shadow] duration-200 ease-out
                         hover:border-riot-red/40">
        <SettingToggle
          label="Per-Map Agent Stats"
          description="Break down every agent by map instead of pooling all matches together"
          checked={enabled}
          onChange={handleToggle}
        />
      </section>

      {!enabled ? (
        <p className="text-sm text-white/40 py-8 text-center">
          Per-map stats are turned off. Enable the toggle above to collect them.
        </p>
      ) : error ? (
        <p className="text-sm text-riot-red py-8 text-center">{error}</p>
      ) : eligible.length === 0 ? (
        <p className="text-sm text-white/40 py-8 text-center">
          No profiles with a VALORANT account yet. Sign in on the home page first.
        </p>
      ) : mapStats.length === 0 ? (
        <p className="text-sm text-white/40 py-8 text-center">
          {loading ? "Loading map data…" : "No map data for this profile yet. Hit Refresh."}
        </p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {mapStats.map((stat, index) => (
            <article
              key={stat.map}
              className="view-card rounded-md bg-bg-card border border-white/10 overflow-hidden
                         transition-[border-color,box-shadow] duration-200 ease-out
                         hover:border-riot-red/40 hover:shadow-[0_0_20px_rgba(255,70,85,0.08)]"
              style={{ animationDelay: `${index * 60}ms` }}
            >
              <div className="relative h-20 overflow-hidden">
                {splashFor(stat.map) ? (
                  <img
                    src={splashFor(stat.map)}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                ) : (
                  <div className="absolute inset-0 bg-white/[0.04] flex items-center justify-center">
                    <MapIcon size={18} className="text-white/20" />
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-bg-card via-bg-card/60 to-transparent" />
                <div className="absolute bottom-1.5 left-3 right-3 flex items-end justify-between">
                  <h2 className="text-sm font-bold text-white drop-shadow">{stat.map}</h2>
                  <div className="text-[10px] text-white/50 font-medium">
                    {stat.games} {stat.games === 1 ? "game" : "games"} · ACS {stat.avg_score}
                  </div>
                </div>
              </div>

              <div className="px-3 pb-2.5 -mt-1">
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="text-white/40">
                    {stat.wins}W / {stat.games - stat.wins}L
                  </span>
                  <span className={`font-bold ${winrateTone(stat.winrate)}`}>{stat.winrate}%</span>
                </div>

                <div className="divide-y divide-white/5">
                  {stat.agents.map((agent) => (
                    <div key={agent.agent} className="flex items-center gap-2.5 py-1.5">
                      {agent.display_icon ? (
                        <img
                          src={agent.display_icon}
                          alt=""
                          className="w-7 h-7 rounded-md bg-white/5 object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-md bg-white/5 shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium text-white truncate">{agent.agent}</div>
                        <div className="text-[10px] text-white/30">
                          {agent.role || "Unknown role"} · {agent.games}{" "}
                          {agent.games === 1 ? "game" : "games"}
                        </div>
                      </div>
                      <div className="text-[10px] text-white/30">ACS {agent.avg_score}</div>
                      <div
                        className={`text-xs font-bold w-9 text-right ${winrateTone(agent.winrate)}`}
                      >
                        {agent.winrate}%
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
