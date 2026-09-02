interface Option {
  value: string;
  label: string;
}

interface SettingDropdownProps {
  label: string;
  description?: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}

export function SettingDropdown({
  label,
  description,
  value,
  options,
  onChange,
}: SettingDropdownProps) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <div>
        <div className="text-sm font-medium text-white">{label}</div>
        {description && (
          <div className="text-xs text-white/40 mt-0.5">{description}</div>
        )}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="shrink-0 rounded-md border border-white/10 bg-bg-dark px-3 py-1.5 text-sm text-white focus:outline-none focus:border-riot-red/60"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}
