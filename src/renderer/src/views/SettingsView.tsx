import { useCallback, useEffect, useRef, useState } from "react";
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
  const [exportPasskey, setExportPasskey] = useState("");
  const [importPasskey, setImportPasskey] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleExport = useCallback(async () => {
    if (!exportPasskey) return;
    setExporting(true);
    try {
      const result = await call<{ data: number[] }>("export_profiles", { passkey: exportPasskey });
      if (result?.data) {
        const blob = new Blob([new Uint8Array(result.data)], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `riotswitcher-profiles-${new Date().toISOString().slice(0, 10)}.rsprofile`;
        a.click();
        URL.revokeObjectURL(url);
        setExportPasskey("");
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 2000);
      }
    } catch (e) {
      console.error("export failed", e);
    } finally {
      setExporting(false);
    }
  }, [call, exportPasskey]);

  const handleImport = useCallback(async () => {
    if (!importPasskey || !importFile) return;
    setImporting(true);
    setImportResult("");
    try {
      const arrayBuffer = await importFile.arrayBuffer();
      const data = Array.from(new Uint8Array(arrayBuffer));
      const result = await call<{ imported: number; skipped: number; total: number }>(
        "import_profiles",
        { passkey: importPasskey, data, merge: true }
      );
      if (result) {
        setImportResult(
          `Imported ${result.imported} of ${result.total} profiles` +
          (result.skipped > 0 ? ` (${result.skipped} already existed)` : "")
        );
        setImportPasskey("");
        setImportFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        // Refresh profiles list
        void call<Profile[]>("get_profiles").then((p) => setProfiles(p ?? []));
      }
    } catch (e) {
      setImportResult("Import failed: " + String(e));
    } finally {
      setImporting(false);
    }
  }, [call, importPasskey, importFile]);

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
              { value: "zh", label: "\u4E2D\u6587" },
              { value: "fr", label: "Fran\u00E7ais" },
            ]}
            onChange={(v) => update("Language", v)}
          />
        </>
      ),
    },
    {
      title: "Import / Export Profiles",
      rows: (
        <div className="py-2 space-y-4">
          {/* Export */}
          <div>
            <p className="text-white/70 text-sm font-medium mb-1.5">Export</p>
            <p className="text-white/40 text-xs mb-2">Encrypt and download all profiles as a backup file</p>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Encryption passkey"
                value={exportPasskey}
                onChange={(e) => setExportPasskey(e.target.value)}
                className="flex-1 h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-sm
                           placeholder:text-white/30 focus:outline-none focus:border-riot-red/50"
              />
              <button
                onClick={() => void handleExport()}
                disabled={!exportPasskey || exporting}
                className="h-8 px-4 rounded-md text-xs font-semibold text-black bg-riot-red
                           hover:bg-riot-red/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                           inline-flex items-center gap-1.5"
              >
                {exporting && <span className="spinner-icon" />}
                {exportSuccess && (
                  <svg className="checkmark-icon" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {exporting ? "Exporting…" : exportSuccess ? "Exported!" : "Export"}
              </button>
            </div>
          </div>

          {/* Import */}
          <div>
            <p className="text-white/70 text-sm font-medium mb-1.5">Import</p>
            <p className="text-white/40 text-xs mb-2">Restore profiles from a backup file (duplicates are skipped)</p>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="file"
                ref={fileInputRef}
                accept=".rsprofile"
                onChange={(e) => setImportFile(e.target.files?.[0] ?? null)}
                className="flex-1 text-xs text-white/50 file:mr-2 file:py-1 file:px-2 file:rounded-md
                           file:border-0 file:text-xs file:font-semibold file:bg-white/10 file:text-white/70
                           hover:file:bg-white/20 file:cursor-pointer"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="password"
                placeholder="Decryption passkey"
                value={importPasskey}
                onChange={(e) => setImportPasskey(e.target.value)}
                className="flex-1 h-8 px-3 rounded-md bg-white/5 border border-white/10 text-white text-sm
                           placeholder:text-white/30 focus:outline-none focus:border-riot-red/50"
              />
              <button
                onClick={() => void handleImport()}
                disabled={!importPasskey || !importFile || importing}
                className="h-8 px-4 rounded-md text-xs font-semibold text-black bg-riot-red
                           hover:bg-riot-red/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                           inline-flex items-center gap-1.5"
              >
                {importing && <span className="spinner-icon" />}
                {importing ? "Importing…" : "Import"}
              </button>
            </div>
            {importResult && (
              <p key={importResult} className={`result-message text-xs mt-1.5 ${importResult.includes("failed") ? "text-riot-red" : "text-emerald-400"}`}>
                {importResult}
              </p>
            )}
          </div>
        </div>
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
            className="view-card rounded-md bg-bg-card border border-white/10 p-4
                       transition-[border-color,box-shadow] duration-200 ease-out
                       hover:border-riot-red/40 hover:shadow-[0_0_20px_rgba(255,70,85,0.08)]"
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
