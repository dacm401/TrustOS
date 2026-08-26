"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { v4 as uuid } from "uuid";
import { lazy, Suspense, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { ChatInterface } from "@/components/chat/ChatInterface";
import { SettingsModal } from "@/components/chat/SettingsModal";
import { TaskPanel } from "@/components/workbench/TaskPanel";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { Skeleton } from "@/components/ui/ErrorBoundary";
import { fetchPendingPermissions, fetchGatewayHealth, GATEWAY_CONFIGURED } from "@/lib/api";

// 5F2 前端流畅度: 视图级代码分割 — 首屏只加载 Chat，其余视图按需懒加载 chunk
const LazyTaskPanel = TaskPanel; // TaskPanel 常驻首屏（workbench 顶栏）
const MemoryGovernanceSurface = lazy(() => import("@/components/memory/MemoryGovernanceSurface"));
const DashboardView = lazy(() => import("@/components/views/DashboardView"));
const TasksView = lazy(() => import("@/components/views/TasksView"));
const ArchiveView = lazy(() => import("@/components/views/ArchiveView"));
const PermissionsView = lazy(() => import("@/components/views/PermissionsView"));
const ManagerView = lazy(() => import("@/components/views/ManagerView"));
const AuditReviewSurface = lazy(() =>
  import("@/components/audit/AuditReviewSurface").then((m) => ({ default: m.AuditReviewSurface }))
);
const EvidencePanel = lazy(() =>
  import("@/components/workbench/EvidencePanel").then((m) => ({ default: m.EvidencePanel }))
);
const TracePanel = lazy(() =>
  import("@/components/workbench/TracePanel").then((m) => ({ default: m.TracePanel }))
);
const HealthPanel = lazy(() =>
  import("@/components/workbench/HealthPanel").then((m) => ({ default: m.HealthPanel }))
);
const DebugPanel = lazy(() =>
  import("@/components/workbench/DebugPanel").then((m) => ({ default: m.DebugPanel }))
);

// Suspense + ErrorBoundary 包装，避免懒加载 chunk 失败炸掉整页
function LazyView({ name, children }: { name: string; children: ReactNode }) {
  return (
    <ErrorBoundary name={name} fallback={<div className="p-4 text-xs" style={{ color: "var(--text-muted)" }}>视图加载失败，请刷新</div>}>
      <Suspense fallback={<div className="p-4"><Skeleton className="h-24 w-full" /></div>}>
        {children}
      </Suspense>
    </ErrorBoundary>
  );
}

type NavView = "chat" | "tasks" | "memory" | "dashboard" | "archive" | "permissions" | "manager" | "audit";

type WorkbenchTab = "evidence" | "trace" | "health" | "debug";

export default function HomePage() {
  const router = useRouter();
  const { user, token, isLoading } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // UI-1: 追踪选中任务的运行状态（用于 TracePanel 轮询决策）
  const [selectedTaskStatus, setSelectedTaskStatus] = useState<string | undefined>(undefined);
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchTab>("evidence");
  // userId derived from auth — falls back to username so backend can route by identity
  const userId = user?.username ?? "anonymous";
  const [activeNav, setActiveNav] = useState<NavView>("chat");
  const [sessionId, setSessionId] = useState<string>(() => uuid());
  const [pendingPermCount, setPendingPermCount] = useState(0);
  // Gateway is optional. When not configured, the backend self-observes,
  // so we start as "observed" (true) instead of flashing "Unobserved".
  const [gatewayOnline, setGatewayOnline] = useState<boolean>(GATEWAY_CONFIGURED);
  const gwTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Auth guard: redirect to login if not authenticated
  useEffect(() => {
    if (!isLoading && !token) {
      router.replace("/login");
    }
  }, [isLoading, token, router]);

  // Poll pending permission count every 15s
  useEffect(() => {
    if (!token || !userId || userId === "anonymous") return;
    const poll = () => {
      fetchPendingPermissions(userId)
        .then((r) => setPendingPermCount(r.requests?.length ?? 0))
        .catch(() => {});
    };
    poll();
    const iv = setInterval(poll, 15000);
    return () => clearInterval(iv);
  }, [token, userId]);

  // Poll Gateway health every 15s for observation tracking
  useEffect(() => {
    const poll = () => {
      fetchGatewayHealth()
        .then((gh) => setGatewayOnline(gh.status === "ok"))
        .catch(() => setGatewayOnline(false));
    };
    poll();
    gwTimerRef.current = setInterval(poll, 15_000);
    return () => { if (gwTimerRef.current) clearInterval(gwTimerRef.current); };
  }, []);

  const tabs: { id: WorkbenchTab; icon: string; label: string }[] = [
    { id: "evidence", icon: "🔍", label: "证据" },
    { id: "trace", icon: "⚡", label: "轨迹" },
    { id: "health", icon: "💚", label: "健康" },
    { id: "debug", icon: "🔧", label: "调试" },
  ];

  // Show loading spinner while hydrating auth state
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: "var(--bg-base)" }}>
        <div className="flex flex-col items-center gap-3">
          <div className="text-3xl">🦀</div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>加载中…</div>
        </div>
      </div>
    );
  }

  // Don't render app content if not authenticated (will redirect)
  if (!token) return null;

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {/* Header */}
      <Header
        userId={userId}
        onUserIdChange={() => {}} // no-op: identity is locked to auth user
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      {/* Body: Sidebar + Chat + optional Workbench */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Sidebar */}
        <Sidebar
          activeNav={activeNav}
          onNavChange={(id) => setActiveNav(id as NavView)}
          onSettingsClick={() => setShowSettings(true)}
          pendingPermCount={pendingPermCount}
        />

        {/* Center: View Area */}
        <main
          className="flex-1 overflow-hidden"
          style={{ maxWidth: sidebarOpen ? undefined : "100%" }}
        >
          {activeNav === "chat" && (
            <ChatInterface
              onTaskIdChange={setSelectedTaskId}
              userId={userId}
              sessionId={sessionId}
              onSessionIdChange={setSessionId}
              gatewayOnline={gatewayOnline}
            />
          )}

          {activeNav === "tasks" && (
            <LazyView name="TasksView"><TasksView userId={userId} /></LazyView>
          )}

          {activeNav === "memory" && (
            <LazyView name="MemoryGovernanceSurface"><MemoryGovernanceSurface /></LazyView>
          )}

          {activeNav === "dashboard" && (
            <LazyView name="DashboardView"><DashboardView userId={userId} onNavChange={(v) => setActiveNav(v as NavView)} /></LazyView>
          )}

          {activeNav === "archive" && (
            <LazyView name="ArchiveView"><ArchiveView sessionId={sessionId} userId={userId} /></LazyView>
          )}

          {activeNav === "permissions" && (
            <LazyView name="PermissionsView"><PermissionsView userId={userId} /></LazyView>
          )}

          {activeNav === "manager" && (
            <LazyView name="ManagerView"><ManagerView userId={userId} /></LazyView>
          )}

          {activeNav === "audit" && (
            <LazyView name="AuditReviewSurface"><AuditReviewSurface sessionId={sessionId} userId={userId} /></LazyView>
          )}
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
                onTaskSelect={(taskId: string) => {
                  setSelectedTaskId(taskId);
                }}
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
                  <LazyView name="EvidencePanel"><EvidencePanel taskId={selectedTaskId} userId={userId} sessionId={sessionId} /></LazyView>
                )}
                {workbenchTab === "trace" && (
                  <LazyView name="TracePanel"><TracePanel taskId={selectedTaskId} userId={userId} taskStatus={selectedTaskStatus} /></LazyView>
                )}
                {workbenchTab === "health" && (
                  <LazyView name="HealthPanel"><HealthPanel /></LazyView>
                )}
                {workbenchTab === "debug" && (
                  <LazyView name="DebugPanel"><DebugPanel taskId={selectedTaskId} userId={userId} /></LazyView>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>

      <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </div>
  );
}
