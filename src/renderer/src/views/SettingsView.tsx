import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Archive, Download, EyeOff, Palette, RefreshCw, Rocket, SlidersHorizontal } from "lucide-react";
import { SettingToggle } from "../components/SettingToggle";
import { SettingDropdown } from "../components/SettingDropdown";
import { useToast } from "../components/Toast";
import { useAppearance } from "../hooks/useAppearance";
import { CUSTOM_ID, SCALE_DEFAULT, SCALE_MAX, SCALE_MIN, THEMES, customTheme } from "../lib/appearance";
import { useIPC } from "../hooks/useIPC";
import { base64ToBlob } from "../utils/base64";
import type { Profile } from "../types/profile";

interface ConfigState {
  [key: string]: unknown;
}

export default function SettingsView() {
  const { call } = useIPC();
  const toast = useToast();
  const { theme, scale, custom, setTheme, setScale, setCustom } = useAppearance();
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
  const [updateState, setUpdateState] = useState<string>("idle");
  const [updateVersion, setUpdateVersion] = useState<string>("");
  const [updatePercent, setUpdatePercent] = useState<number>(0);

  useEffect(() => {
    void call<ConfigState>("get_config").then((c) => setConfig(c ?? {}));
    void call<Profile[]>("get_profiles").then((p) => setProfiles(p ?? []));
  }, [call]);

  useEffect(() => {
    if (!window.electronAPI?.onUpdateStatus) return;
    const unsub = window.electronAPI.onUpdateStatus((data) => {
      setUpdateState(data.state);
      if (data.version) setUpdateVersion(data.version);
      if (data.percent !== undefined) setUpdatePercent(data.percent);
    });
    return unsub;
  }, []);

  const update = useCallback(
    (key: string, value: unknown) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      void call("set_config", { key, value });
    },
    [call]
  );

  // Appearance is applied instantly (and live in the other windows); the backend copy is debounced.
  const mirror = useCallback(
    (key: string, value: unknown) => {
      if (mirrorTimer.current) clearTimeout(mirrorTimer.current);
      mirrorTimer.current = setTimeout(() => void call("set_config", { key, value }), 250);
    },
    [call]
  );
  const pickTheme = (id: string) => {
    setTheme(id);
    void call("set_config", { key: "BackgroundTheme", value: id });
    toast.show({ id: "theme", kind: "info", title: "Theme changed", message: THEMES.find((t) => t.id === id)?.name, duration: 2200 });
  };
  const changeScale = (k: number) => {
    setScale(k);
    mirror("PlayerCardScale", k);
  };
  const changeCustom = (hex: string) => {
    setCustom(hex);
    mirror("CustomThemeColor", hex);
    void call("set_config", { key: "BackgroundTheme", value: CUSTOM_ID });
  };
  const customDef = customTheme(custom);
  const scalePct = Math.round((scale / SCALE_DEFAULT) * 100);
  const scaleFill = `${((scale - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100}%`;

  const handleExport = useCallback(async () => {
    if (!exportPasskey) return;
    setExporting(true);
    try {
      const result = await call<{ data: string }>("export_profiles", { passkey: exportPasskey });
      if (result?.data) {
        // The backend returns base64 text, not raw bytes. Passing the string
        // straight to Uint8Array silently produced a 0-byte backup file.
        const blob = base64ToBlob(result.data);
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `riotswitcher-profiles-${new Date().toISOString().slice(0, 10)}.rsprofile`;
        a.click();
        URL.revokeObjectURL(url);
        setExportPasskey("");
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 2000);
        toast.show({ kind: "success", title: "Profiles exported", message: "Backup file downloaded" });
      }
    } catch (e) {
      console.error("export failed", e);
      toast.show({ kind: "error", title: "Export failed", message: String(e) });
    } finally {
      setExporting(false);
    }
  }, [call, exportPasskey, toast]);

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
        toast.show({ kind: "success", title: "Import complete", message: `${result.imported} of ${result.total} profiles imported` });
        // Refresh profiles list
        void call<Profile[]>("get_profiles").then((p) => setProfiles(p ?? []));
      }
    } catch (e) {
      setImportResult("Import failed: " + String(e));
      toast.show({ kind: "error", title: "Import failed", message: String(e) });
    } finally {
      setImporting(false);
    }
  }, [call, importPasskey, importFile, toast]);

  const sourceDir = String(config.SharedSettingsSourceDirectory ?? "");
  const sourceProfile = String(config.SharedSettingsSourceProfile ?? "");
  const sourceName = sourceDir || sourceProfile;

  const exportLabel = exporting ? "Exporting…" : exportSuccess ? "Exported!" : "Export";

  // Scrollspy: the rail follows what you're reading; clicking a category glides to it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const secRefs = useRef<(HTMLElement | null)[]>([]);
  const lockUntil = useRef(0);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  const [spacer, setSpacer] = useState(0);

  const computeActive = useCallback(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const y = sc.scrollTop + 110;
    let idx = 0;
    secRefs.current.forEach((el, i) => { if (el && el.offsetTop <= y) idx = i; });
    // scrolled all the way down: the last category is the one in view
    if (sc.scrollHeight > sc.clientHeight && sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2) idx = secRefs.current.length - 1;
    setActiveIdx(idx);
  }, []);

  const onScroll = useCallback(() => {
    if (Date.now() >= lockUntil.current) computeActive();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(computeActive, 140); // re-sync once a smooth scroll has stopped
  }, [computeActive]);

  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);

  // Every section must be able to reach the top of the panel, otherwise the last (short) ones can
  // never become "active". The spacer is exactly the extra room the last section needs.
  const measureSpacer = useCallback(() => {
    const sc = scrollRef.current;
    const last = secRefs.current[secRefs.current.length - 1];
    if (!sc || !last) return;
    setSpacer(Math.max(0, sc.clientHeight - last.offsetHeight - 44));
  }, []);

  useLayoutEffect(() => {
    measureSpacer();
    const sc = scrollRef.current;
    const content = sc?.firstElementChild;
    if (typeof ResizeObserver === "undefined" || !sc || !content) return;
    const ro = new ResizeObserver(measureSpacer);
    ro.observe(sc);
    ro.observe(content);
    return () => ro.disconnect();
  }, [measureSpacer]);

  const goTo = (i: number) => {
    const sc = scrollRef.current, el = secRefs.current[i];
    setActiveIdx(i);
    if (!sc || !el) return;
    lockUntil.current = Date.now() + 700;
    const top = Math.max(0, el.offsetTop - 14);
    if (typeof sc.scrollTo === "function") sc.scrollTo({ top, behavior: "smooth" });
    else sc.scrollTop = top;
  };

  const cards = [
    {
      id: "appearance", nav: "Appearance", icon: Palette, blurb: "Make the app yours: background colour and card size.",
      title: "Appearance",
      rows: (
        <div className="py-2">
          <div className="pt-1">
            <div className="text-sm font-medium text-white">Background</div>
            <div className="text-xs text-white/40 mt-0.5">The light on top stays; the colour underneath changes</div>
          </div>
          <div className="theme-grid" role="radiogroup" aria-label="Background theme">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={theme === t.id}
                className={`theme-swatch ${theme === t.id ? "is-on" : ""}`}
                style={{ ["--sw-base" as string]: t.base, ["--sw-glow" as string]: `rgba(${t.glow}, 0.55)` }}
                onClick={() => pickTheme(t.id)}
              >
                <span className="chip" />
                <span className="nm">{t.name}</span>
              </button>
            ))}
            <label
              className={`theme-swatch ${theme === CUSTOM_ID ? "is-on" : ""}`}
              style={{ ["--sw-base" as string]: customDef.base, ["--sw-glow" as string]: `rgba(${customDef.glow}, 0.55)` }}
              title="Pick any colour"
            >
              <span className="chip chip-custom" />
              <span className="nm">Custom</span>
              <input
                type="color"
                value={custom}
                className="swatch-color"
                aria-label="Custom background colour"
                onChange={(e) => changeCustom(e.target.value)}
              />
            </label>
          </div>
          <div className="pt-4 border-t border-white/5 mt-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-white">Player card size</div>
                <div className="text-xs text-white/40 mt-0.5">Scales the cards on the main window</div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold tabular-nums text-white/80 w-12 text-right">{scalePct}%</span>
                <button
                  type="button"
                  onClick={() => changeScale(SCALE_DEFAULT)}
                  disabled={scalePct === 100}
                  className="btn-ghost h-7 px-3 text-[10px]"
                >
                  Reset
                </button>
              </div>
            </div>
            <input
              type="range"
              className="scale-range mt-2"
              min={SCALE_MIN}
              max={SCALE_MAX}
              step={0.01}
              value={scale}
              style={{ ["--fill" as string]: scaleFill }}
              onChange={(e) => changeScale(parseFloat(e.target.value))}
              aria-label="Player card size"
            />
          </div>
        </div>
      ),
    },
    {
      id: "riot", nav: "Riot Client", icon: Rocket, blurb: "What happens when you press START.",
      title: "Riot Client",
      rows: (
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
      ),
    },
    {
      id: "sync", nav: "Game Sync", icon: RefreshCw, blurb: "Keep your in-game settings identical across accounts.",
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
      id: "privacy", nav: "Privacy", icon: EyeOff, blurb: "Control how you show up to friends.",
      title: "Privacy",
      rows: (
          <SettingToggle
            label="Appear Offline"
            description="Mask your presence while Riot Client is running"
            checked={!!config.AppearOffline}
            onChange={(v) => update("AppearOffline", v)}
          />
      ),
    },
    {
      id: "system", nav: "System", icon: SlidersHorizontal, blurb: "Tray behaviour and language.",
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
      id: "updates", nav: "Updates", icon: Download, blurb: "Stay on the latest version.",
      title: "Updates",
      rows: (
        <div className="py-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white/70 text-sm font-medium">
                {updateState === "checking" && "Checking for updates…"}
                {updateState === "up-to-date" && "You're up to date"}
                {updateState === "available" && `Update found: v${updateVersion} — downloading…`}
                {updateState === "downloading" && `Downloading… ${updatePercent}%`}
                {updateState === "downloaded" && `v${updateVersion} ready — restarting soon…`}
                {updateState === "error" && "Update check failed"}
                {updateState === "idle" && "Auto-checks on startup"}
              </p>
              <p className="text-white/40 text-xs">
                Updates download and install automatically on restart
              </p>
            </div>
            <div className="flex gap-2">
              {(updateState === "idle" || updateState === "up-to-date" || updateState === "error") && (
                <button
                  onClick={() => window.electronAPI?.checkUpdate()}
                  className="h-8 px-4 rounded-md text-xs font-semibold btn-primary transition-colors"
                >
                  Check
                </button>
              )}
              {updateState === "downloaded" && (
                <button
                  onClick={() => window.electronAPI?.installUpdate()}
                  className="h-8 px-4 rounded-md text-xs font-semibold text-black bg-emerald-500
                             hover:bg-emerald-600 transition-colors"
                >
                  Restart & Install
                </button>
              )}
            </div>
          </div>
          {updateState === "downloading" && (
            <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
              <div
                className="h-full rounded-full bg-riot-red transition-all duration-300"
                style={{ width: `${updatePercent}%` }}
              />
            </div>
          )}
        </div>
      ),
    },
    {
      id: "backup", nav: "Backup", icon: Archive, blurb: "Move your profiles between machines with an encrypted file.",
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
                className="h-8 px-4 rounded-md text-xs font-semibold btn-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors
                           inline-flex items-center gap-1.5"
              >
                {exporting && <span className="spinner-icon" />}
                {exportSuccess && (
                  <svg className="checkmark-icon" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8.5l3 3 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {exportLabel}
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
                className="h-8 px-4 rounded-md text-xs font-semibold btn-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors
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
    <div className="settings-shell">
      <aside className="settings-nav" aria-label="Settings categories">
        <div className="settings-nav-head">Settings</div>
        <div className="settings-nav-list">
          <span className="settings-nav-ind" style={{ transform: `translateY(${activeIdx * 100}%)` }} aria-hidden />
          {cards.map((c, i) => (
            <button
              key={c.id}
              type="button"
              className={`settings-nav-item ${i === activeIdx ? "is-on" : ""}`}
              onClick={() => goTo(i)}
              aria-current={i === activeIdx ? "true" : undefined}
            >
              <c.icon size={15} />
              <span>{c.nav}</span>
            </button>
          ))}
        </div>
        <div className="settings-nav-foot"><kbd>Esc</kbd> to close</div>
      </aside>

      <div className="settings-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="settings-content">
          {cards.map((card, i) => (
            <section
              key={card.id}
              id={`settings-${card.id}`}
              ref={(el) => { secRefs.current[i] = el; }}
              className={`set-sec ${i === activeIdx ? "is-on" : ""}`}
              style={{ ["--s" as string]: i }}
            >
              <div className="set-sec-inner">
                <div className="set-sec-head">
                  <card.icon size={16} />
                  <h2 className="set-sec-title">{card.title}</h2>
                </div>
                <p className="set-sec-blurb">{card.blurb}</p>
                <div className="set-sec-card divide-y divide-white/5">{card.rows}</div>
              </div>
            </section>
          ))}
          <div className="settings-spacer" style={{ height: spacer }} />
        </div>
      </div>
    </div>
  );
}
