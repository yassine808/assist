import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, Plus, CheckCircle2, XCircle } from "lucide-react";
import { useAccountDetection } from "../hooks/useAccountDetection";

export default function AddAccountView() {
  const navigate = useNavigate();
  const { active, progress, start, stop } = useAccountDetection();

  const isDetected = progress?.status === "detected";
  const isCreated = progress?.status === "created";
  const isError = progress?.status === "error" || progress?.status === "canceled";

  return (
    <div className="p-6 max-w-xl">
      <button
        onClick={() => navigate("/")}
        className="flex items-center gap-1.5 mb-5 text-white/50 hover:text-white transition-colors"
      >
        <ArrowLeft size={14} /> Back to profiles
      </button>

      <h1 className="text-2xl font-bold text-white mb-2">Add Account</h1>
      <p className="text-white/50 text-sm mb-6">
        We'll open the Riot Client and watch for a new account to log in. When
        one appears, a profile is created automatically.
      </p>

      <div className="rounded-md bg-bg-card border border-white/10 p-5">
        {!active && !isDetected && !isCreated && !isError && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <button
              onClick={() => void start()}
              className="flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
            >
              <Plus size={15} /> Start Detection
            </button>
            <p className="text-white/40 text-xs">
              Launch the Riot Client and log in with the account you want to add.
            </p>
          </div>
        )}

        {(active || isDetected) && !isCreated && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <Loader2 size={28} className="animate-spin text-riot-red" />
            <p className="text-white font-medium">
              {progress?.message ?? "Waiting for login…"}
            </p>
            <button
              onClick={() => void stop()}
              className="mt-2 text-white/40 hover:text-white text-xs transition-colors"
            >
              Cancel detection
            </button>
          </div>
        )}

        {isCreated && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <CheckCircle2 size={32} className="text-emerald-400" />
            <p className="text-white font-medium">Profile created!</p>
            {progress?.profile_name && (
              <p className="text-white/50 text-sm">{progress.profile_name}</p>
            )}
            <button
              onClick={() => navigate("/")}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
            >
              View Profiles
            </button>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <XCircle size={32} className="text-riot-red" />
            <p className="text-white font-medium">{progress?.message}</p>
            <button
              onClick={() => void start()}
              className="mt-2 flex items-center gap-2 px-4 py-2 rounded-md text-sm font-semibold text-black bg-riot-red hover:bg-riot-red/90 transition-colors"
            >
              <Plus size={15} /> Try Again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
