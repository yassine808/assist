import { NavLink } from "react-router-dom";
import { Home, Settings as SettingsIcon } from "lucide-react";

const navItems = [
  { to: "/", label: "Home", icon: Home, exact: true },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export function Sidebar() {
  return (
    <div className="w-[88px] shrink-0 bg-bg-dark border-r border-white/5 py-4 flex flex-col items-center gap-2">
      {navItems.map(({ to, label, icon: Icon, exact }) => (
        <NavLink
          key={to}
          to={to}
          end={exact}
          className={({ isActive }) =>
            `no-drag flex flex-col items-center gap-1 w-full py-3 transition-colors ${
              isActive
                ? "text-riot-red"
                : "text-white/40 hover:text-white/80"
            }`
          }
        >
          <Icon size={20} />
          <span className="text-[10px] tracking-wider uppercase">{label}</span>
        </NavLink>
      ))}
    </div>
  );
}
