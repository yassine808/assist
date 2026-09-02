import { useCallback, useEffect, useState } from "react";
import { SettingToggle } from "../components/SettingToggle";
import { SettingDropdown } from "../components/SettingDropdown";
import { useIPC } from "../hooks/useIPC";
import type { Profile } from "../types/profile";

interface ConfigState {
  [key: string]: unknown;
}

export default function SettingsView() {
  const { call } = useIPC();
  const [config, setConfig] = useState<ConfigState>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    void call<ConfigState>("get_config").then((c) => setConfig(c ?? {}));
    void call<Profile[]>("get_profiles").then((p) => setProfiles(p ?? []));
  }, [call]);

  const update = useCallback(
    (key: string, value: unknown) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      void call("set_config", { key, value });
    },
    [call]
  );

  const sourceDir = String(config.SharedSettingsSourceDirectory ?? "");
  const sourceProfile = String(config.SharedSettingsSourceProfile ?? "");
  const sourceName = sourceDir || sourceProfile;

  const cards = [
    {
      title: "Riot Client",
      rows: (
        <>
          <SettingDropdown
            label="Launch Product"
            description="Auto-launch VALORANT or only the Riot Client"
            value={String(config.LaunchProduct ?? "valorant")}
            options={[
              { value: "valorant", label: "VALORANT" },
              { value: "riot", label: "Riot Client" },
            ]}
            onChange={(v) => update("LaunchProduct", v)}
          />
        </>
      ),
    },
    {
      title: "Game Settings Sync",
      rows: (
        <>
          <SettingToggle
            label="Sync Game Settings"
            description="Share settings among profiles via a master snapshot"
            checked={!!config.SyncGameSettings}
            onChange={(v) => update("SyncGameSettings", v)}
          />
          {!!config.SyncGameSettings && (
            <SettingDropdown
              label="Source Profile"
              description="Profile whose settings are treated as the master"
              value={sourceName}
              options={[
                { value: "", label: "None" },
                ...profiles.map((p) => ({
                  value: p.profile_name,
                  label: p.profile_name,
                })),
              ]}
              onChange={(v) => update("SharedSettingsSourceProfile", v)}
            />
          )}
        </>
      ),
    },
    {
      title: "Appear Offline",
      rows: (
        <>
          <SettingToggle
            label="Appear Offline"
            description="Mask your presence while Riot Client is running"
            checked={!!config.AppearOffline}
            onChange={(v) => update("AppearOffline", v)}
          />
        </>
      ),
    },
    {
      title: "System",
      rows: (
        <>
          <SettingToggle
            label="Close to Tray"
            description="Keep running in the tray when the window is closed"
            checked={!!config.CloseToTray}
            onChange={(v) => update("CloseToTray", v)}
          />
          <SettingToggle
            label="Minimize to Tray"
            description="Minimize to the tray instead of the taskbar"
            checked={!!config.MinimizeToTray}
            onChange={(v) => update("MinimizeToTray", v)}
          />
          <SettingDropdown
            label="Language"
            description="Interface language"
            value={String(config.Language ?? "en")}
            options={[
              { value: "en", label: "English" },
              { value: "zh", label: "中文" },
              { value: "fr", label: "Français" },
            ]}
            onChange={(v) => update("Language", v)}
          />
        </>
      ),
    },
  ];

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-bold text-white mb-6">Settings</h1>
      <div className="flex flex-col gap-4">
        {cards.map((card, index) => (
          <section
            key={card.title}
            className="view-card rounded-md bg-bg-card border border-white/10 p-4"
            style={{ animationDelay: `${index * 60}ms` }}
          >
            <h2 className="text-sm font-semibold uppercase tracking-wide text-white/40 mb-1">
              {card.title}
            </h2>
            <div className="divide-y divide-white/5">{card.rows}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
