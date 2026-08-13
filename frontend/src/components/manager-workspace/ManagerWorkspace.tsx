"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { SessionList } from "./SessionList";
import { ManagerConversation } from "./ManagerConversation";
import { SessionDetail } from "./SessionDetail";
import { TaskPanel } from "@/components/workbench/TaskPanel";
import {
  fetchConversations,
  createConversation,
  fetchMemoryRefs,
  attachMemoryRef,
  detachMemoryRef,
  fetchMemory,
  type ManagerConversationRecord,
  type MemoryRefRecord,
} from "@/lib/api";

// MWT-15: Manager ↔ Memory Context Bridge — read-only context-reference panel.
// Shows memory references attached to a manager conversation. These are REFERENCES
// only (memory_id + safe preview), never autonomous memory writes. UI makes this
// explicit so the user understands they are context links, not auto-mutations.
function MemoryContextPanel({
  userId,
  conversationId,
}: {
  userId: string;
  conversationId: string | null;
}) {
  const [refs, setRefs] = useState<MemoryRefRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [memories, setMemories] = useState<{ id: string; category: string | null; preview: string }[]>([]);

  const loadRefs = useCallback(() => {
    if (!conversationId) return;
    setLoading(true);
    fetchMemoryRefs(userId, conversationId)
      .then((data) => setRefs(data.memory_refs ?? []))
      .catch(() => setRefs([]))
      .finally(() => setLoading(false));
  }, [userId, conversationId]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const openPicker = useCallback(() => {
    if (!conversationId) return;
    setPickerOpen(true);
    fetchMemory(userId)
      .then((data) =>
        setMemories(
          (data.entries ?? []).map((e) => ({
            id: e.id,
            category: e.category,
            preview: (e.content ?? "").slice(0, 40),
          }))
        )
      )
      .catch(() => setMemories([]));
  }, [userId, conversationId]);

  const handleAttach = useCallback(
    async (memoryId: string) => {
      if (!conversationId) return;
      try {
        await attachMemoryRef(userId, conversationId, memoryId);
        setPickerOpen(false);
        loadRefs();
      } catch {
        /* silent */
      }
    },
    [userId, conversationId, loadRefs]
  );

  const handleDetach = useCallback(
    async (memoryId: string) => {
      if (!conversationId) return;
      try {
        await detachMemoryRef(userId, conversationId, memoryId);
        loadRefs();
      } catch {
        /* silent */
      }
    },
    [userId, conversationId, loadRefs]
  );

  if (!conversationId) {
    return (
      <div className="px-3 py-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        选择一个会话后可查看记忆上下文引用
      </div>
    );
  }

  return (
    <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          记忆上下文引用
        </span>
        <button
          onClick={openPicker}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            backgroundColor: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          + 关联记忆
        </button>
      </div>
      <div className="text-[9px] mb-1.5" style={{ color: "var(--text-faint)" }}>
        上下文引用（只读），不会自动写入记忆
      </div>

      {loading && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>加载中…</div>}
      {!loading && refs.length === 0 && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>暂无引用</div>
      )}
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {refs.map((r) => (
          <div
            key={r.memory_id}
            className="text-[10px] rounded px-2 py-1"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono truncate" style={{ maxWidth: "120px" }}>
                {r.memory_id.slice(0, 8)}
              </span>
              <button
                onClick={() => handleDetach(r.memory_id)}
                className="text-[9px]"
                style={{ color: "var(--text-faint)" }}
                title="取消关联"
              >
                解绑
              </button>
            </div>
            <div className="truncate" style={{ color: "var(--text-muted)" }}>{r.preview}</div>
            {r.category && (
              <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
                {r.category}
                {r.source ? ` · ${r.source}` : ""}
              </div>
            )}
          </div>
        ))}
      </div>

      {pickerOpen && (
        <div
          className="mt-2 rounded p-2"
          style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              选择记忆（引用，不复制内容）
            </span>
            <button onClick={() => setPickerOpen(false)} className="text-[9px]" style={{ color: "var(--text-faint)" }}>
              关闭
            </button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {memories.map((m) => (
              <button
                key={m.id}
                onClick={() => handleAttach(m.id)}
                className="w-full text-left text-[10px] rounded px-2 py-1"
                style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
              >
                <span className="font-mono">{m.id.slice(0, 8)}</span>
                {m.category ? ` · ${m.category}` : ""}
                <span className="block truncate" style={{ color: "var(--text-muted)" }}>{m.preview}</span>
              </button>
            ))}
            {memories.length === 0 && (
              <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>无可用记忆</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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
        <MemoryContextPanel userId={userId} conversationId={selectedConversationId} />
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
