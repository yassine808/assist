interface SettingToggleProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export function SettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: SettingToggleProps) {
  return (
    <label
      className={`flex items-center justify-between gap-4 py-3 ${
        disabled ? "opacity-50 pointer-events-none" : ""
      }`}
    >
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {description && (
          <div className="text-xs text-white/40 mt-0.5">{description}</div>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`group relative h-[26px] w-[46px] shrink-0 rounded-full transition-all duration-300 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-riot-red/50 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-card ${
          checked
            ? "bg-gradient-to-r from-riot-red to-riot-redDark shadow-[0_0_12px_rgba(255,70,85,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)]"
            : "bg-white/10 shadow-[inset_0_1px_3px_rgba(0,0,0,0.3)]"
        }`}
      >
        <span
          className={`absolute top-[3px] left-[3px] h-[20px] w-[20px] rounded-full transition-all duration-300 ease-out ${
            checked
              ? "translate-x-[20px] bg-white shadow-[0_1px_4px_rgba(0,0,0,0.3),0_0_8px_rgba(255,70,85,0.2)]"
              : "translate-x-0 bg-white/80 shadow-[0_1px_2px_rgba(0,0,0,0.2)]"
          }`}
        />
      </button>
    </label>
  );
}
