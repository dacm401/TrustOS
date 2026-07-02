"use client";
import { useState, useEffect } from "react";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { ChatInterface } from "@/components/chat/ChatInterface";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { TaskPanel } from "@/components/workbench/TaskPanel";
import { EvidencePanel } from "@/components/workbench/EvidencePanel";
import { TracePanel } from "@/components/workbench/TracePanel";
import { HealthPanel } from "@/components/workbench/HealthPanel";
import { DebugPanel } from "@/components/workbench/DebugPanel";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import MemoryView from "@/components/views/MemoryView";
import DashboardView from "@/components/views/DashboardView";
import BetaPanel from "@/components/dashboard/BetaPanel";
import AdminPanel from "@/components/dashboard/AdminPanel";
import TasksView from "@/components/views/TasksView";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

type NavView = "chat" | "tasks" | "memory" | "dashboard" | "beta" | "admin";

const DEFAULT_USER_ID = "dev-user";

type WorkbenchTab = "evidence" | "trace" | "health" | "debug";

export default function HomePage() {
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("evidence");
  const [userId, setUserId] = useState(DEFAULT_USER_ID);
  const [activeNav, setActiveNav] = useState<NavView>("chat");
  const [adminKey, setAdminKey] = useState("admin-changeme");

  useEffect(() => {
    setAdminKey(localStorage?.getItem("trustos_admin_key") ?? "admin-changeme");
  }, []);

  const tabs: { id: WorkbenchTab; icon: string; label: string }[] = [
    { id: "evidence", icon: "🔍", label: "证据" },
    { id: "trace", icon: "⚡", label: "轨迹" },
    { id: "health", icon: "💚", label: "健康" },
    { id: "debug", icon: "🔧", label: "调试" },
  ];

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="flex flex-col h-screen overflow-hidden"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        {/* Header */}
        <Header
          userId={userId}
          onUserIdChange={setUserId}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        {/* Body: Sidebar + Chat + optional Workbench */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Sidebar */}
          <Sidebar activeNav={activeNav} onNavChange={(id) => setActiveNav(id as NavView)} onSettingsClick={() => setShowSettings(true)} />

          {/* Center: View Area - 用CSS隐藏而非卸载，保持状态 */}
          <main
            className="flex-1 overflow-hidden"
            style={{ maxWidth: sidebarOpen ? undefined : "100%" }}
          >
            <ErrorBoundary fallback={
              <div className="flex items-center justify-center h-full p-8 text-sm" style={{ color: "var(--text-secondary)" }}>
                ⚠️ 聊天界面加载失败，请刷新页面重试
              </div>
            }>
              <div style={{ display: activeNav === "chat" ? "block" : "none", height: "100%" }}>
                <ChatInterface
                  onTaskIdChange={setSelectedTaskId}
                  userId={userId}
                />
              </div>
            </ErrorBoundary>

            <ErrorBoundary fallback={
              <div className="flex items-center justify-center h-full p-8 text-sm" style={{ color: "var(--text-secondary)" }}>
                ⚠️ 任务视图加载失败，请刷新页面重试
              </div>
            }>
              <div style={{ display: activeNav === "tasks" ? "block" : "none", height: "100%" }}>
                <TasksView userId={userId} />
              </div>
            </ErrorBoundary>

            <ErrorBoundary fallback={
              <div className="flex items-center justify-center h-full p-8 text-sm" style={{ color: "var(--text-secondary)" }}>
                ⚠️ 记忆视图加载失败，请刷新页面重试
              </div>
            }>
              <div style={{ display: activeNav === "memory" ? "block" : "none", height: "100%" }}>
                <MemoryView userId={userId} />
              </div>
            </ErrorBoundary>

            <ErrorBoundary fallback={
              <div className="flex items-center justify-center h-full p-8 text-sm" style={{ color: "var(--text-secondary)" }}>
                ⚠️ 数据面板加载失败，请刷新页面重试
              </div>
            }>
              <div style={{ display: activeNav === "dashboard" ? "block" : "none", height: "100%" }}>
                <DashboardView userId={userId} />
              </div>
              <div style={{ display: activeNav === "beta" ? "block" : "none", height: "100%" }}>
                <BetaPanel userId={userId} />
              </div>
              <div style={{ display: activeNav === "admin" ? "block" : "none", height: "100%" }}>
                <AdminPanel adminKey={adminKey} />
              </div>
            </ErrorBoundary>
          </main>

          {/* Right: Workbench Sidebar */}
          {sidebarOpen && (
            <aside
              className="w-96 flex-shrink-0 flex flex-col overflow-hidden"
              style={{
                backgroundColor: "var(--bg-surface)",
                borderLeft: "1px solid var(--border-subtle)",
              }}
            >
              {/* Task Panel: top fixed height */}
              <div
                className="flex-shrink-0 overflow-hidden"
                style={{ height: 220, borderBottom: "1px solid var(--border-subtle)" }}
              >
                <TaskPanel
                  userId={userId}
                  onTaskSelect={setSelectedTaskId}
                  selectedTaskId={selectedTaskId}
                />
              </div>

              {/* Tab content area: flex-1 */}
              <div className="flex flex-col flex-1 overflow-hidden">
                {/* Tab bar */}
                <div
                  className="flex flex-shrink-0"
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setWorkbenchTab(tab.id)}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs transition-all relative"
                      style={{
                        color: workbenchTab === tab.id ? "var(--text-accent)" : "var(--text-muted)",
                        backgroundColor: workbenchTab === tab.id ? "var(--bg-overlay)" : "transparent",
                      }}
                    >
                      <span className="text-[11px]">{tab.icon}</span>
                      <span className="hidden xl:inline">{tab.label}</span>
                      {/* Active underline */}
                      {workbenchTab === tab.id && (
                        <span
                          className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                          style={{ backgroundColor: "var(--accent-blue)" }}
                        />
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab content */}
                <div className="flex-1 overflow-hidden">
                  {workbenchTab === "evidence" && (
                    <ErrorBoundary>
                      <EvidencePanel taskId={selectedTaskId} userId={userId} />
                    </ErrorBoundary>
                  )}
                  {workbenchTab === "trace" && (
                    <ErrorBoundary>
                      <TracePanel taskId={selectedTaskId} userId={userId} />
                    </ErrorBoundary>
                  )}
                  {workbenchTab === "health" && (
                    <ErrorBoundary>
                      <HealthPanel />
                    </ErrorBoundary>
                  )}
                  {workbenchTab === "debug" && (
                    <ErrorBoundary>
                      <DebugPanel taskId={selectedTaskId} userId={userId} />
                    </ErrorBoundary>
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>

        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </QueryClientProvider>
  );
}
