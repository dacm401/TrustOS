"use client";

type NavItem = {
  id: string;
  icon: string;
  label: string;
};

const NAV_ITEMS: NavItem[] = [
  { id: "chat",        icon: "💬", label: "Chat" },
  { id: "tasks",       icon: "📋", label: "Tasks" },
  { id: "memory",      icon: "🧠", label: "Memory" },
  { id: "archive",     icon: "📦", label: "Archive" },
  { id: "permissions", icon: "🔐", label: "Perms" },
  { id: "dashboard",   icon: "📊", label: "Dashboard" },
];

interface SidebarProps {
  activeNav: string;
  onNavChange: (id: string) => void;
  onSettingsClick: () => void;
  pendingPermCount?: number;
}

export function Sidebar({ activeNav, onNavChange, onSettingsClick, pendingPermCount = 0 }: SidebarProps) {
  return (
    <aside
      className="w-[52px] flex-shrink-0 flex flex-col items-center py-3 border-r"
      style={{
        backgroundColor: "var(--bg-surface)",
        borderColor: "var(--border-subtle)",
      }}
    >
      {/* Nav items */}
      <div className="flex flex-col items-center gap-1 flex-1 w-full px-1">
        {NAV_ITEMS.map((item) => {
          const isActive = activeNav === item.id;
          const hasBadge = item.id === "permissions" && pendingPermCount > 0;
          return (
            <button
              key={item.id}
              onClick={() => onNavChange(item.id)}
              title={item.label}
              className="relative w-full flex flex-col items-center justify-center py-2 rounded-lg text-xs transition-all"
              style={{
                backgroundColor: isActive ? "var(--bg-overlay)" : "transparent",
                color: isActive ? "var(--text-primary)" : "var(--text-muted)",
              }}
            >
              {/* Active left border */}
              {isActive && (
                <span
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r"
                  style={{ backgroundColor: "var(--accent-blue)" }}
                />
              )}
              <span className="text-sm leading-none mb-0.5 relative">
                {item.icon}
                {/* Badge dot for pending permissions */}
                {hasBadge && (
                  <span
                    className="absolute -top-1 -right-1 text-[8px] min-w-[14px] h-[14px] flex items-center justify-center rounded-full font-bold"
                    style={{ backgroundColor: "#f59e0b", color: "white" }}
                  >
                    {pendingPermCount > 9 ? "9+" : pendingPermCount}
                  </span>
                )}
              </span>
              <span
                className="text-[9px] leading-none"
                style={{ color: isActive ? "var(--text-accent)" : "var(--text-muted)" }}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom: Settings */}
      <div className="w-full px-1">
        <button
          title="Settings"
          onClick={onSettingsClick}
          className="w-full flex flex-col items-center justify-center py-2 rounded-lg text-xs transition-all cursor-pointer hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="text-sm leading-none mb-0.5">⚙️</span>
          <span className="text-[9px] leading-none" style={{ color: "var(--text-muted)" }}>Settings</span>
        </button>
      </div>
    </aside>
  );
}
