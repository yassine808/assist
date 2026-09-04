import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, CheckCircle2, XCircle, Shield } from "lucide-react";
import { useAccountDetection } from "../hooks/useAccountDetection";

export default function AddAccountView() {
  const navigate = useNavigate();
  const { active, progress, start, stop } = useAccountDetection();

  const isCreated = progress?.status === "created";
  const isError = progress?.status === "error" || progress?.status === "canceled";

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
    <div className="p-6 max-w-xl">
      <button
        onClick={() => { void stop(); navigate("/"); }}
        className="flex items-center gap-1.5 mb-5 text-white/50 hover:text-white transition-colors"
      >
        ← Back to profiles
      </button>

      <h1 className="text-2xl font-bold text-white mb-2">Add Account</h1>
      <p className="text-white/50 text-sm mb-6">
        The Riot Client is opening. Log in with the account you want to add — it
        will be saved automatically.
      </p>

      <div className="rounded-md bg-bg-card border border-white/10 p-5">
        {/* Detecting / waiting */}
        {active && !isCreated && (
          <div className="flex flex-col items-center text-center gap-4 py-8">
            <div className="relative">
              <Shield size={40} className="text-riot-red/60" />
              <Loader2 size={20} className="animate-spin text-riot-red absolute -bottom-1 -right-1" />
            </div>
            <p className="text-white font-medium">
              {progress?.message ?? "Waiting for login…"}
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
          <div className="flex flex-col items-center text-center gap-3 py-8">
            <CheckCircle2 size={36} className="text-emerald-400" />
            <p className="text-white font-medium">Account saved!</p>
            {progress?.profile_name && (
              <p className="text-white/50 text-sm">{progress.profile_name}</p>
            )}
            <p className="text-white/30 text-xs">Returning to profiles…</p>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="flex flex-col items-center text-center gap-3 py-8">
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
  );
}
