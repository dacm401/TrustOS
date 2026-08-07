"use client";
import { useState } from "react";
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/lib/query-client';
import { SettingsModal } from "@/components/chat/SettingsModal";
import { EvidencePanel } from "@/components/workbench/EvidencePanel";
import { HealthPanel } from "@/components/workbench/HealthPanel";
import { DebugPanel } from "@/components/workbench/DebugPanel";
import { Header } from "@/components/layout/Header";
import { Sidebar } from "@/components/layout/Sidebar";
import { ChatInterface } from "@/components/chat/ChatInterface";
import OverviewView from "@/components/views/OverviewView";
import AdminPanel from "@/components/dashboard/AdminPanel";
import EventChainViewer from "@/components/dashboard/EventChainViewer";
import GatewayStatusCard from "@/components/dashboard/GatewayStatusCard";
import EvidenceReportPanel from "@/components/dashboard/EvidenceReportPanel";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";

type NavView = "chat" | "overview" | "evidence" | "events" | "gateway" | "advanced";
type AdvancedTab = "diagnostics" | "admin";

const DEFAULT_USER_ID = "dev-user";

export default function HomePage() {
  const [showSettings, setShowSettings] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedTaskId] = useState<string | null>(null);
  const [userId] = useState(DEFAULT_USER_ID);
  const [activeNav, setActiveNav] = useState<NavView>("chat");
  const [advancedTab, setAdvancedTab] = useState<AdvancedTab>("diagnostics");
  const [adminKey] = useState("admin-changeme");

  return (
    <QueryClientProvider client={queryClient}>
      <div
        className="flex flex-col h-screen overflow-hidden"
        style={{ backgroundColor: "var(--bg-base)" }}
      >
        {/* Header */}
        <Header
          userId={userId}
          onUserIdChange={() => {}}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((v) => !v)}
        />

        {/* Body: Sidebar + Main View */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: Sidebar */}
          <Sidebar
            activeNav={activeNav}
            onNavChange={(id) => setActiveNav(id as NavView)}
            onSettingsClick={() => setShowSettings(true)}
          />

          {/* Center: Main View Area */}
          <main className="flex-1 overflow-hidden">
            {/* Chat — primary interaction */}
            {activeNav === "chat" && (
              <ErrorBoundary>
                <ChatInterface userId={userId} />
              </ErrorBoundary>
            )}

            {/* Overview */}
            {activeNav === "overview" && (
              <ErrorBoundary>
                <OverviewView />
              </ErrorBoundary>
            )}

            {/* Evidence Report */}
            {activeNav === "evidence" && (
              <ErrorBoundary>
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-5xl mx-auto space-y-6">
                    <h1
                      className="text-xl font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      📋 Evidence Report
                    </h1>
                    <p
                      className="text-sm"
                      style={{ color: "var(--text-secondary)" }}
                    >
                      TRST-4A — Reviewer-facing evidence report with hash verification,
                      privacy statement, and known limitations.
                    </p>
                    <EvidenceReportPanel />
                    {/* Task-level evidence (when task selected) */}
                    <EvidencePanel taskId={selectedTaskId} userId={userId} />
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* Events & Traces */}
            {activeNav === "events" && (
              <ErrorBoundary>
                <div style={{ height: "100%" }}>
                  <EventChainViewer />
                </div>
              </ErrorBoundary>
            )}

            {/* Gateway */}
            {activeNav === "gateway" && (
              <ErrorBoundary>
                <div className="h-full overflow-y-auto p-6">
                  <div className="max-w-5xl mx-auto space-y-6">
                    <h1
                      className="text-xl font-semibold"
                      style={{ color: "var(--text-primary)" }}
                    >
                      ⚙️ Gateway
                    </h1>
                    <GatewayStatusCard />
                    <div className="rounded-xl border p-6" style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-subtle)",
                    }}>
                      <h3 className="text-sm font-semibold mb-4" style={{ color: "var(--text-primary)" }}>
                        System Health
                      </h3>
                      <HealthPanel />
                    </div>
                  </div>
                </div>
              </ErrorBoundary>
            )}

            {/* Advanced */}
            {activeNav === "advanced" && (
              <ErrorBoundary>
                <div className="h-full flex flex-col overflow-hidden">
                  {/* Advanced tab bar */}
                  <div
                    className="flex flex-shrink-0 border-b px-4"
                    style={{
                      backgroundColor: "var(--bg-surface)",
                      borderColor: "var(--border-subtle)",
                    }}
                  >
                    <button
                      onClick={() => setAdvancedTab("diagnostics")}
                      className="px-4 py-2.5 text-sm transition-all relative"
                      style={{
                        color: advancedTab === "diagnostics" ? "var(--text-accent)" : "var(--text-muted)",
                      }}
                    >
                      🔍 Diagnostics
                      {advancedTab === "diagnostics" && (
                        <span
                          className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                          style={{ backgroundColor: "var(--accent-blue)" }}
                        />
                      )}
                    </button>
                    <button
                      onClick={() => setAdvancedTab("admin")}
                      className="px-4 py-2.5 text-sm transition-all relative"
                      style={{
                        color: advancedTab === "admin" ? "var(--text-accent)" : "var(--text-muted)",
                      }}
                    >
                      🛡️ Admin
                      {advancedTab === "admin" && (
                        <span
                          className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                          style={{ backgroundColor: "var(--accent-blue)" }}
                        />
                      )}
                    </button>
                  </div>

                  {/* Advanced tab content */}
                  <div className="flex-1 overflow-y-auto">
                    {advancedTab === "diagnostics" && (
                      <div className="p-6 max-w-5xl mx-auto space-y-6">
                        <div
                          className="rounded-xl border p-4 mb-4"
                          style={{
                            backgroundColor: "var(--bg-warning-subtle, rgba(245,158,11,0.08))",
                            borderColor: "var(--border-warning, var(--border-subtle))",
                          }}
                        >
                          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                            ⚠️ <strong>Developer Diagnostics</strong> — Local development only.
                            Not authenticated RBAC. Not production admin.
                          </p>
                        </div>
                        <DebugPanel taskId={selectedTaskId} userId={userId} />
                        <HealthPanel />
                      </div>
                    )}
                    {advancedTab === "admin" && (
                      <div className="p-6 max-w-5xl mx-auto space-y-6">
                        <div
                          className="rounded-xl border p-4 mb-4"
                          style={{
                            backgroundColor: "var(--bg-warning-subtle, rgba(245,158,11,0.08))",
                            borderColor: "var(--border-warning, var(--border-subtle))",
                          }}
                        >
                          <p className="text-xs" style={{ color: "var(--text-secondary)" }}>
                            ⚠️ <strong>Local diagnostic only</strong> — Not production RBAC.
                            Admin key: <code style={{ color: "var(--text-accent)" }}>admin-changeme</code>
                          </p>
                        </div>
                        <AdminPanel adminKey={adminKey} />
                      </div>
                    )}
                  </div>
                </div>
              </ErrorBoundary>
            )}
          </main>
        </div>

        <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
      </div>
    </QueryClientProvider>
  );
}
