"use client";

type NavItem = {
  id: string;
  icon: string;
  label: string;
};

// UI-IA-CONSOLIDATION 阶段 3：统一为中文，去掉缩写。
//
// `manager` 由 "Manager" 改为「委托」：该视图实际展示 Manager 与 Worker 之间的
// 委托会话与契约（fetchManagerConversations / fetchManagerContracts），
// 叫「管理器」会让人误以为是某种控制面板。
//
// ⚠️ 待确认：原方案建议 manager 并入 audit，但代码层面二者并不重叠 ——
//      manager = 委托会话与契约（任务如何被分派）
//      audit   = 人工审核队列与审批（人工介入点）
//    是否合并需 Boss 确认，暂保留独立入口。
const NAV_ITEMS: NavItem[] = [
  { id: "chat",        icon: "💬", label: "对话" },
  { id: "tasks",       icon: "📋", label: "任务" },
  { id: "memory",      icon: "🧠", label: "记忆" },
  { id: "permissions", icon: "🔐", label: "权限" },
  { id: "workhistory", icon: "🕓", label: "工作历史" },
  { id: "dashboard",   icon: "📊", label: "仪表盘" },
  { id: "audit",       icon: "🛡️", label: "审计" },
];

// RFC-002 菜单收敛（2026-09-21）：原「归档」并入「工作历史」(type=archive 子视图)，
// 原「委托」并入「审计」(委托会话 tab)；侧栏从 9 → 7，避免重复入口。

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
              data-testid={`nav-${item.id}`}
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
          title="设置"
          onClick={onSettingsClick}
          className="w-full flex flex-col items-center justify-center py-2 rounded-lg text-xs transition-all cursor-pointer hover:opacity-80"
          style={{ color: "var(--text-muted)" }}
        >
          <span className="text-sm leading-none mb-0.5">⚙️</span>
          <span className="text-[9px] leading-none" style={{ color: "var(--text-muted)" }}>设置</span>
        </button>
      </div>
    </aside>
  );
}
