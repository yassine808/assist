import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Shield, UserPlus } from "lucide-react";
import { useAccountDetection } from "../hooks/useAccountDetection";

const keyframes = `
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes scaleIn { from { transform: scale(0.92); } to { transform: scale(1); } }
@keyframes pulse { 0%, 100% { transform: scale(1); opacity: 1; } 50% { transform: scale(1.15); opacity: 0.6; } }
@keyframes successPop { 0% { transform: scale(0.6); opacity: 0; } 60% { transform: scale(1.1); } 100% { transform: scale(1); opacity: 1; } }
`;

export default function AddAccountView() {
  const navigate = useNavigate();
  const { active, progress, start, stop, confirmSave } = useAccountDetection();

  const isCreated = progress?.status === "created";
  const isError = progress?.status === "error" || progress?.status === "canceled";
  const isConfirming = progress?.status === "confirm_save";
  const isAlreadyAdded = progress?.status === "already_added";

  // Auto-start detection when the page loads
  useEffect(() => {
    if (!active && !isCreated && !isError) {
      void start();
    }
  }, []);

  // Auto-navigate back after profile is created
  useEffect(() => {
    if (isCreated) {
      const t = setTimeout(() => navigate("/"), 2000);
      return () => clearTimeout(t);
    }
  }, [isCreated, navigate]);

  return (
    <>
      <style>{keyframes}</style>
      <div className="p-6 max-w-xl">
        <button
          onClick={() => { void stop(); navigate("/"); }}
          className="flex items-center gap-1.5 mb-5 text-white/50 hover:text-white transition-colors"
        >
          ← Back to profiles
        </button>

        <h1 className="text-2xl font-bold text-white mb-2">Add Account</h1>
        <p className="text-white/50 text-sm mb-6">
          {isConfirming
            ? "A new account was detected. Do you want to save it?"
            : isAlreadyAdded
              ? "This account is already added. Opening login to switch\u2026"
              : "The Riot Client is opening. Log in with the account you want to add."}
        </p>

        <div className="rounded-md bg-bg-card border border-white/10 p-5">
          {/* Confirm save - new account detected */}
          {isConfirming && (
            <div
              className="flex flex-col items-center text-center gap-4 py-8"
              style={{ animation: "fadeIn 0.35s ease-out" }}
            >
              <div className="relative">
                <UserPlus size={40} className="text-riot-red/60" />
              </div>
              <div>
                <p className="text-white font-medium mb-1">
                  New account detected
                </p>
                {progress?.display && (
                  <p className="text-white/60 text-sm">{progress.display}</p>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => void confirmSave(false)}
                  className="px-4 py-2 rounded-md text-sm font-semibold text-white/70 hover:text-white bg-white/5 hover:bg-white/10 transition-colors"
                  style={{ animation: "scaleIn 0.25s ease-out" }}
                >
                  Skip
                </button>
                <button
                  onClick={() => void confirmSave(true)}
                  className="px-4 py-2 rounded-md text-sm font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
                  style={{ animation: "scaleIn 0.25s ease-out 0.05s both" }}
                >
                  Save Account
                </button>
              </div>
            </div>
          )}

          {/* Already added - re-launching */}
          {isAlreadyAdded && !isConfirming && (
            <div className="flex flex-col items-center text-center gap-4 py-8">
              <div className="relative">
                <Shield size={40} className="text-amber-400/60" />
                <Loader2
                  size={20}
                  className="text-amber-400 absolute -bottom-1 -right-1"
                  style={{ animation: "pulse 2s ease-in-out infinite" }}
                />
              </div>
              <p className="text-white font-medium">
                {progress?.message ?? "Account already added, reopening login\u2026"}
              </p>
              <button
                onClick={() => { void stop(); navigate("/"); }}
                className="mt-2 text-white/40 hover:text-white text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Detecting / waiting */}
          {active && !isCreated && !isConfirming && !isAlreadyAdded && (
            <div className="flex flex-col items-center text-center gap-4 py-8">
              <div className="relative">
                <Shield size={40} className="text-riot-red/60" />
                <Loader2
                  size={20}
                  className="text-riot-red absolute -bottom-1 -right-1"
                  style={{ animation: "pulse 2s ease-in-out infinite" }}
                />
              </div>
              <p className="text-white font-medium">
                {progress?.message ?? "Waiting for login\u2026"}
              </p>
              <button
                onClick={() => { void stop(); navigate("/"); }}
                className="mt-2 text-white/40 hover:text-white text-xs transition-colors"
              >
                Cancel
              </button>
            </div>
          )}

          {/* Created - success */}
          {isCreated && (
            <div
              className="flex flex-col items-center text-center gap-3 py-8"
              style={{ animation: "successPop 0.4s ease-out" }}
            >
              <CheckCircle2 size={36} className="text-emerald-400" />
              <p className="text-white font-medium">Account saved!</p>
              {progress?.profile_name && (
                <p className="text-white/50 text-sm">{progress.profile_name}</p>
              )}
              <p className="text-white/30 text-xs">Returning to profiles\u2026</p>
            </div>
          )}

          {/* Error */}
          {isError && (
            <div
              className="flex flex-col items-center text-center gap-3 py-8"
              style={{ animation: "fadeIn 0.3s ease-out" }}
            >
              <XCircle size={32} className="text-riot-red" />
              <p className="text-white font-medium">{progress?.message}</p>
              <button
                onClick={() => void start()}
                className="mt-2 flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
              >
                Try Again
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
