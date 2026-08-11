"use client";

import { useState, useCallback, useMemo } from "react";
import { SessionList } from "./SessionList";
import { ManagerConversation } from "./ManagerConversation";
import { SessionDetail } from "./SessionDetail";
import { TaskPanel } from "@/components/workbench/TaskPanel";

interface ManagerWorkspaceProps {
  userId: string;
}

export function ManagerWorkspace({ userId }: ManagerWorkspaceProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [sessionDetailRefreshKey, setSessionDetailRefreshKey] = useState(0);

  // Stable conversation ID for the Manager's conversation
  const conversationId = useMemo(() => `manager-${userId}`, [userId]);

  const handleSessionCreated = useCallback((sessionId: string) => {
    // Refresh session list
    setSessionRefreshKey((k) => k + 1);
    // Auto-select the new session
    setSelectedSessionId(sessionId);
  }, []);

  const handleSessionUpdated = useCallback((sessionId: string) => {
    // Refresh session events for the updated session
    setSessionDetailRefreshKey((k) => k + 1);
  }, []);

  const handleSelectSession = useCallback((sessionId: string) => {
    setSelectedSessionId((prev) => (prev === sessionId ? null : sessionId));
    setSessionDetailRefreshKey((k) => k + 1);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      {/* Left: Session List */}
      <div className="w-56 flex-shrink-0 h-full">
        <SessionList
          userId={userId}
          selectedSessionId={selectedSessionId}
          onSelectSession={handleSelectSession}
          refreshKey={sessionRefreshKey}
        />
      </div>

      {/* Center: Manager Conversation */}
      <div className="flex-1 h-full min-w-0">
        <ManagerConversation
          userId={userId}
          conversationId={conversationId}
          onSessionCreated={handleSessionCreated}
          onSessionUpdated={handleSessionUpdated}
          onSelectSession={handleSelectSession}
        />
      </div>

      {/* Right: Session Detail */}
      <div className="w-80 flex-shrink-0 h-full">
        <SessionDetail
          userId={userId}
          sessionId={selectedSessionId}
          refreshKey={sessionDetailRefreshKey}
        />
      </div>

      {/* Far Right: Task Panel + Task Evidence (MWT-4A) */}
      <div
        className="w-80 flex-shrink-0 h-full"
        style={{ backgroundColor: "var(--bg-surface)", borderLeft: "1px solid var(--border-subtle)" }}
      >
        <TaskPanel userId={userId} sessionId={selectedSessionId ?? undefined} />
      </div>
    </div>
  );
}
