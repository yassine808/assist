import { useCallback, useRef, useState } from "react";
import { useIPC } from "../hooks/useIPC";
import type { Profile } from "../types/profile";

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: () => void;
}

export default function ImportExportModal({ open, onClose, onImported }: ImportExportModalProps) {
  const { call } = useIPC();
  const [exportPasskey, setExportPasskey] = useState("");
  const [importPasskey, setImportPasskey] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<string>("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        onImported?.();
      }
    } catch (e) {
      setImportResult("Import failed: " + String(e));
    } finally {
      setImporting(false);
    }
  }, [call, importPasskey, importFile, onImported]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="w-[420px] rounded-xl bg-[#12161f] border border-white/10 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        style={{ animation: "fadeIn 0.2s ease-out" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-white font-bold text-base">Import / Export Profiles</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        <div className="space-y-4">
          {/* Export */}
          <div>
            <p className="text-white/70 text-sm font-medium mb-1">Export</p>
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

          <div className="border-t border-white/5" />

          {/* Import */}
          <div>
            <p className="text-white/70 text-sm font-medium mb-1">Import</p>
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
      </div>
    </div>
  );
}
