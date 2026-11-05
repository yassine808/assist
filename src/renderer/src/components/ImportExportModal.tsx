import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Check, Copy, Eye, EyeOff, FileUp, Lock, X } from "lucide-react";
import { useIPC } from "../hooks/useIPC";
import { base64ToBlob } from "../utils/base64";
import { useToast } from "./Toast";
import Modal from "./Modal";
import type { Profile } from "../types/profile";

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
  /** Profiles offered in the "choose accounts" export mode. */
  profiles?: Profile[];
}

type Tab = "export" | "import";

const MIN_KEY = 4;

function strength(pw: string): { level: number; label: string } {
  if (pw.length === 0) return { level: 0, label: "" };
  if (pw.length < MIN_KEY) return { level: 1, label: "Too short" };
  let score = 2;
  if (pw.length >= 8) score++;
  if (pw.length >= 12 && /[a-z]/.test(pw) && /[A-Z0-9]/.test(pw)) score++;
  return { level: score, label: ["", "Too short", "OK", "Good", "Strong"][score] };
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

function PasskeyField({ value, onChange, placeholder, autoFocus, copyable }: Readonly<{ value: string; onChange: (v: string) => void; placeholder: string; autoFocus?: boolean; copyable?: boolean }>) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      console.error("copy passkey failed", e);
    }
  };
  return (
    <div className="ie-field">
      <Lock size={14} className="ie-field-lead" />
      <input
        type={show ? "text" : "password"}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        data-autofocus={autoFocus ? "" : undefined}
        autoComplete="off"
        spellCheck={false}
      />
      {copyable && (
        <button
          type="button"
          className="ie-field-eye"
          onClick={() => void copy()}
          disabled={!value}
          aria-label="Copy passkey"
          title={copied ? "Copied" : "Copy passkey"}
          tabIndex={-1}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      )}
      <button type="button" className="ie-field-eye" onClick={() => setShow((s) => !s)} aria-label={show ? "Hide passkey" : "Show passkey"} tabIndex={-1}>
        {show ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
}

export default function ImportExportModal({ open, onClose, onImported, profiles = [] }: Readonly<ImportExportModalProps>) {
  const { call } = useIPC();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("export");
  const [exportPasskey, setExportPasskey] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [importPasskey, setImportPasskey] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wasOpen = useRef(false);

  // fresh state every time the dialog opens
  useEffect(() => {
    if (open && !wasOpen.current) {
      setTab("export");
      setExportPasskey(""); setImportPasskey(""); setImportFile(null); setImportResult(null);
      setExportSuccess(false); setDragOver(false);
      setScope("all"); setPicked(new Set());
    }
    wasOpen.current = open;
  }, [open]);

  const handleExport = useCallback(async () => {
    if (!exportPasskey) return;
    setExporting(true);
    try {
      const names = scope === "selected" ? [...picked] : undefined;
      const result = await call<{ data: string }>(
        "export_profiles",
        names ? { passkey: exportPasskey, names } : { passkey: exportPasskey }
      );
      if (result?.data) {
        const url = URL.createObjectURL(base64ToBlob(result.data));
        const a = document.createElement("a");
        a.href = url;
        a.download = `riotswitcher-profiles-${new Date().toISOString().slice(0, 10)}.rsprofile`;
        a.click();
        URL.revokeObjectURL(url);
        setExportPasskey("");
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 2500);
        toast.show({ kind: "success", title: "Profiles exported", message: "Backup file downloaded" });
      }
    } catch (e) {
      console.error("export failed", e);
      toast.show({ kind: "error", title: "Export failed", message: String(e) });
    } finally {
      setExporting(false);
    }
  }, [call, exportPasskey, scope, picked, toast]);

  const handleImport = useCallback(async () => {
    if (!importPasskey || !importFile) return;
    setImporting(true);
    setImportResult(null);
    try {
      const bytes = new Uint8Array(await importFile.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const result = await call<{ imported: number; skipped: number; total: number }>(
        "import_profiles",
        { passkey: importPasskey, data: btoa(binary), merge: true }
      );
      if (result) {
        const text = `Imported ${result.imported} of ${result.total} profiles` + (result.skipped > 0 ? ` (${result.skipped} already existed)` : "");
        setImportResult({ ok: true, text });
        toast.show({ kind: "success", title: "Import complete", message: text });
        setImportPasskey("");
        setImportFile(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
        onImported?.();
      }
    } catch (e) {
      setImportResult({ ok: false, text: "Import failed: " + String(e) });
      toast.show({ kind: "error", title: "Import failed", message: "Wrong passkey or damaged file" });
      setImportFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } finally {
      setImporting(false);
    }
  }, [call, importPasskey, importFile, onImported, toast]);

  const pickFile = (f: File | null | undefined) => {
    if (!f) return;
    setImportFile(f);
    setImportResult(null);
  };

  const exStrength = strength(exportPasskey);
  const allPicked = profiles.length > 0 && picked.size === profiles.length;
  const togglePick = (name: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  const canExport =
    exportPasskey.length >= MIN_KEY &&
    !exporting &&
    (scope === "all" ? profiles.length > 0 : picked.size > 0);
  const canImport = importPasskey.length >= MIN_KEY && !!importFile && !importing;

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!exporting && !importing}
      eyebrow="Backup"
      title="Import / Export"
      icon={<ArrowDownToLine size={18} />}
      width={470}
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-ghost h-10 px-5 text-[11px]">Close</button>
          {tab === "export" ? (
            <button type="button" onClick={() => void handleExport()} disabled={!canExport} className="btn-primary h-10 px-6 text-[11px]">
              {exporting ? <span className="spinner-icon" /> : exportSuccess ? <Check size={14} strokeWidth={3} /> : <ArrowDownToLine size={14} />}
              {exporting ? "Exporting…" : exportSuccess ? "Exported!" : "Export backup"}
            </button>
          ) : (
            <button type="button" onClick={() => void handleImport()} disabled={!canImport} className="btn-primary h-10 px-6 text-[11px]">
              {importing ? <span className="spinner-icon" /> : <ArrowUpFromLine size={14} />}
              {importing ? "Importing…" : "Import backup"}
            </button>
          )}
        </>
      }
    >
      <div className="ie-tabs" style={{ ["--t" as string]: tab === "export" ? 0 : 1 }} role="tablist">
        <button type="button" role="tab" aria-selected={tab === "export"} className={tab === "export" ? "is-on" : ""} onClick={() => setTab("export")}>
          <ArrowDownToLine size={13} /> Export
        </button>
        <button type="button" role="tab" aria-selected={tab === "import"} className={tab === "import" ? "is-on" : ""} onClick={() => setTab("import")}>
          <ArrowUpFromLine size={13} /> Import
        </button>
        <span className="ie-tabs-ind" aria-hidden />
      </div>

      <div className="ie-stage">
        {tab === "export" ? (
          <div key="export" className="ie-pane">
            <p className="rs-text-sm">
              {scope === "all"
                ? <>Saves <b>all your profiles</b> into one encrypted <code>.rsprofile</code> file you can keep as a backup or move to another PC.</>
                : <>Saves <b>{picked.size === profiles.length ? "all" : picked.size === 1 ? "one profile" : `${picked.size} profiles`}</b> into one encrypted <code>.rsprofile</code> file.</>}
            </p>
            <div className="ie-scope" role="radiogroup" aria-label="Profiles to export">
              <button
                type="button"
                role="radio"
                aria-checked={scope === "all"}
                className={scope === "all" ? "is-on" : ""}
                onClick={() => setScope("all")}
              >
                All profiles <b>{profiles.length}</b>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={scope === "selected"}
                className={scope === "selected" ? "is-on" : ""}
                onClick={() => setScope("selected")}
                disabled={profiles.length === 0}
              >
                Select accounts <b>{picked.size || ""}</b>
              </button>
            </div>
            {scope === "selected" && (
              <div className="ie-pick">
                <div className="ie-pick-head">
                  <span>{picked.size} of {profiles.length} selected</span>
                  <button
                    type="button"
                    onClick={() => setPicked(allPicked ? new Set() : new Set(profiles.map((p) => p.profile_name)))}
                  >
                    {allPicked ? "Clear" : "Select all"}
                  </button>
                </div>
                <div className="ie-pick-list">
                  {profiles.map((p) => (
                    <label key={p.profile_name} className={`ie-pick-row${picked.has(p.profile_name) ? " is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={picked.has(p.profile_name)}
                        onChange={() => togglePick(p.profile_name)}
                      />
                      <span className="ie-pick-name" title={p.profile_name}>{p.profile_name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <label className="ie-label">Choose a passkey</label>
            <PasskeyField value={exportPasskey} onChange={setExportPasskey} placeholder="Encryption passkey" autoFocus copyable />
            <div className="ie-meter" data-level={exStrength.level}>
              <span /><span /><span /><span />
              <em>{exStrength.label}</em>
            </div>
            <p className="ie-note">You will need this passkey to import the file. It cannot be recovered if you forget it — use the copy button to save it somewhere safe.</p>
          </div>
        ) : (
          <div key="import" className="ie-pane">
            <p className="rs-text-sm">Restores profiles from a backup file. Profiles that already exist are <b>skipped</b>, nothing is overwritten.</p>
            <input ref={fileInputRef} type="file" accept=".rsprofile" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
            {importFile ? (
              <div className="ie-file">
                <FileUp size={18} />
                <div className="ie-file-meta"><span title={importFile.name}>{importFile.name}</span><em>{formatSize(importFile.size)}</em></div>
                <button type="button" onClick={() => { setImportFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} aria-label="Remove file"><X size={14} /></button>
              </div>
            ) : (
              <button
                type="button"
                className={`ie-drop ${dragOver ? "is-over" : ""}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); pickFile(e.dataTransfer.files?.[0]); }}
              >
                <FileUp size={22} />
                <span><b>Drop your backup here</b> or click to browse</span>
                <em>.rsprofile</em>
              </button>
            )}
            <label className="ie-label">Passkey</label>
            <PasskeyField value={importPasskey} onChange={setImportPasskey} placeholder="Decryption passkey" />
            {importResult && (
              <p key={importResult.text} className={`ie-result ${importResult.ok ? "is-ok" : "is-bad"}`}>
                {importResult.ok ? <Check size={14} strokeWidth={3} /> : <X size={14} strokeWidth={3} />}
                {importResult.text}
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
