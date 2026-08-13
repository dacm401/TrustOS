"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { SessionList } from "./SessionList";
import { ManagerConversation } from "./ManagerConversation";
import { SessionDetail } from "./SessionDetail";
import { TaskPanel } from "@/components/workbench/TaskPanel";
import { fetchConversations, createConversation, type ManagerConversationRecord } from "@/lib/api";

interface ManagerWorkspaceProps {
  userId: string;
}

export function ManagerWorkspace({ userId }: ManagerWorkspaceProps) {
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionRefreshKey, setSessionRefreshKey] = useState(0);
  const [sessionDetailRefreshKey, setSessionDetailRefreshKey] = useState(0);

  // MWT-14: ManagerConversation list + selection (replaces hardcoded `manager-${userId}`)
  const [conversations, setConversations] = useState<ManagerConversationRecord[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [convLoading, setConvLoading] = useState(false);

  const loadConversations = useCallback(() => {
    setConvLoading(true);
    fetchConversations(userId, 50)
      .then((data) => {
        const list = data.conversations ?? [];
        setConversations(list);
        setSelectedConversationId((prev) => prev ?? list[0]?.id ?? null);
      })
      .catch(() => {
        // silent: backend conversations may be empty / unavailable
      })
      .finally(() => setConvLoading(false));
  }, [userId]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  const handleNewConversation = useCallback(async () => {
    try {
      const { conversation } = await createConversation(userId);
      setConversations((prev) => [conversation, ...prev]);
      setSelectedConversationId(conversation.id);
    } catch {
      // silent fail
    }
  }, [userId]);

  // conversationId passed to ManagerConversation: selected real id, else fallback literal
  const conversationId = selectedConversationId ?? `manager-${userId}`;

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
      {/* Left: Conversation + Session List */}
      <div className="w-56 flex-shrink-0 h-full flex flex-col">
        {/* MWT-14: ManagerConversation selector */}
        <div
          className="flex-shrink-0 px-3 py-2"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
              经理会话
            </span>
            <button
              onClick={handleNewConversation}
              className="text-[10px] px-2 py-0.5 rounded transition-opacity"
              style={{
                backgroundColor: "var(--bg-overlay)",
                color: "var(--text-secondary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              + 新建
            </button>
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {convLoading && (
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                加载中…
              </div>
            )}
            {!convLoading && conversations.length === 0 && (
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                暂无会话
              </div>
            )}
            {conversations.map((conv) => (
              <button
                key={conv.id}
                onClick={() => setSelectedConversationId(conv.id)}
                className="w-full text-left text-[11px] truncate rounded px-2 py-1 transition-colors"
                style={{
                  backgroundColor:
                    conv.id === selectedConversationId ? "var(--accent-blue)" : "var(--bg-overlay)",
                  color: conv.id === selectedConversationId ? "#fff" : "var(--text-secondary)",
                }}
                title={conv.title ?? conv.id}
              >
                {conv.title ?? "未命名会话"}
              </button>
            ))}
          </div>
        </div>

        {/* Existing session list */}
        <div className="flex-1 min-h-0">
          <SessionList
            userId={userId}
            selectedSessionId={selectedSessionId}
            onSelectSession={handleSelectSession}
            refreshKey={sessionRefreshKey}
          />
        </div>
      </div>

      {/* Center: Manager Conversation */}
      <div className="flex-1 h-full min-w-0">
        <ManagerConversation
          key={conversationId}
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
