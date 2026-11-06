import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Coffee, Download, Palette, RefreshCw, Rocket, SlidersHorizontal } from "lucide-react";
import { SettingToggle } from "../components/SettingToggle";
import { SettingDropdown } from "../components/SettingDropdown";
import { useToast } from "../components/Toast";
import { useAppearance } from "../hooks/useAppearance";
import { CUSTOM_ID, SCALE_DEFAULT, SCALE_MAX, SCALE_MIN, THEMES, customTheme } from "../lib/appearance";
import { useIPC } from "../hooks/useIPC";
import { sfx } from "../lib/sfx";
import type { Profile } from "../types/profile";

interface ConfigState {
  [key: string]: unknown;
}

const SUPPORT_URL = "https://github.com/sponsors/yassine808";

export default function SettingsView() {
  const { call } = useIPC();
  const toast = useToast();
  const { theme, scale, custom, setTheme, setScale, setCustom } = useAppearance();
  const mirrorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [config, setConfig] = useState<ConfigState>({});
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [appVersion, setAppVersion] = useState<string>("");
  const [updateState, setUpdateState] = useState<string>("idle");
  const [updateVersion, setUpdateVersion] = useState<string>("");
  const [updatePercent, setUpdatePercent] = useState<number>(0);
  const [sounds, setSounds] = useState(() => sfx.isEnabled());

  const changeSounds = (v: boolean) => {
    setSounds(v);
    sfx.setEnabled(v);
    if (v) sfx.tick(); // short confirmation, the first one also unlocks audio
  };

  useEffect(() => {
    void call<ConfigState>("get_config").then((c) => setConfig(c ?? {}));
    void call<Profile[]>("get_profiles").then((p) => setProfiles(p ?? []));
    void window.electronAPI?.getVersion?.().then((v) => setAppVersion(v ?? ""));
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

  const sourceDir = String(config.SharedSettingsSourceDirectory ?? "");
  const sourceProfile = String(config.SharedSettingsSourceProfile ?? "");
  const sourceName = sourceDir || sourceProfile;

  // Scrollspy: the rail follows what you're reading; clicking a category glides to it.
  const scrollRef = useRef<HTMLDivElement>(null);
  const secRefs = useRef<(HTMLElement | null)[]>([]);
  const scrollLocked = useRef(false);
  const scrollLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    if (!scrollLocked.current) computeActive();
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(computeActive, 140); // re-sync once a smooth scroll has stopped
  }, [computeActive]);

  useEffect(() => () => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    if (scrollLockTimer.current) clearTimeout(scrollLockTimer.current);
  }, []);

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
    // Hold the scrollspy while the smooth scroll is in flight. A timer avoids
    // reading wall-clock time during a component render (React purity rule).
    scrollLocked.current = true;
    if (scrollLockTimer.current) clearTimeout(scrollLockTimer.current);
    scrollLockTimer.current = setTimeout(() => { scrollLocked.current = false; }, 700);
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
              onChange={(e) => changeScale(Number.parseFloat(e.target.value))}
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
      id: "system", nav: "System", icon: SlidersHorizontal, blurb: "Tray behaviour, sounds and language.",
      title: "System",
      rows: (
        <>
          <SettingToggle
            label="Interface sounds"
            description="Hover, drag and launch effects"
            checked={sounds}
            onChange={changeSounds}
          />
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
          <div className="mb-3 flex items-center justify-between border-b border-white/[0.06] pb-2">
            <span className="text-xs text-white/40">Installed version</span>
            <span className="text-xs font-semibold text-white/75">
              {appVersion ? `v${appVersion}` : "—"}
            </span>
          </div>
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
      id: "support", nav: "Support", icon: Coffee, blurb: "RiotSwitcher is free and open source — support keeps it going.",
      title: "Support the Project",
      rows: (
        <div className="py-2">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-white/70 text-sm font-medium">Buy me a coffee</p>
              <p className="text-white/40 text-xs mt-0.5">
                One-time or monthly support through GitHub Sponsors. Entirely optional.
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                void window.electronAPI?.openExternal(SUPPORT_URL).catch((e: unknown) => {
                  console.error("open sponsor page failed", e);
                  toast.show({ kind: "error", title: "Could not open the link", message: String(e) });
                });
              }}
              className="btn-primary h-8 px-4 text-[10px] shrink-0 inline-flex items-center gap-1.5"
            >
              <Coffee size={13} /> Support
            </button>
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
