"use client";
import { useState, useEffect, useCallback } from "react";
import {
  fetchManagerConversations,
  fetchManagerContracts,
  setContractStatus,
  reviewContract,
  triggerAttempt,
  type ManagerConversation,
  type ManagerContract,
} from "@/lib/api";

const STATUS_LABEL: Record<ManagerContract["status"], string> = {
  draft: "草稿",
  ready_for_review: "待评审",
  approved: "已批准",
  rejected: "已拒绝",
};

const STATUS_STYLE: Record<ManagerContract["status"], { bg: string; text: string; border: string }> = {
  draft: { bg: "rgba(148,163,184,0.15)", text: "#94a3b8", border: "rgba(148,163,184,0.4)" },
  ready_for_review: { bg: "rgba(245,158,11,0.15)", text: "#fcd34d", border: "rgba(245,158,11,0.4)" },
  approved: { bg: "rgba(16,185,129,0.15)", text: "#6ee7b7", border: "rgba(16,185,129,0.4)" },
  rejected: { bg: "rgba(239,68,68,0.15)", text: "#fca5a5", border: "rgba(239,68,68,0.4)" },
};

function relativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.floor(hours / 24)} 天前`;
}

interface ManagerViewProps {
  userId: string;
}

export default function ManagerView({ userId }: ManagerViewProps) {
  const [conversations, setConversations] = useState<ManagerConversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [contracts, setContracts] = useState<ManagerContract[]>([]);
  const [loadingConv, setLoadingConv] = useState(true);
  const [loadingContracts, setLoadingContracts] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadConversations = useCallback(async () => {
    setLoadingConv(true);
    setError(null);
    try {
      const data = await fetchManagerConversations(userId);
      setConversations(data.conversations ?? []);
      if (!activeId && (data.conversations ?? []).length > 0) {
        setActiveId(data.conversations[0].id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingConv(false);
    }
  }, [userId, activeId]);

  const loadContracts = useCallback(async (convId: string) => {
    setLoadingContracts(true);
    setError(null);
    try {
      const data = await fetchManagerContracts(convId, userId);
      setContracts(data.contracts ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingContracts(false);
    }
  }, [userId]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  useEffect(() => {
    if (activeId) loadContracts(activeId);
  }, [activeId, loadContracts]);

  const runAction = async (contractId: string, fn: () => Promise<void>, okMsg?: string) => {
    setBusyId(contractId);
    setError(null);
    try {
      await fn();
      if (activeId) await loadContracts(activeId);
      if (okMsg) {/* no-op, status reflected in UI */}
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="h-full flex" style={{ backgroundColor: "var(--bg-base)" }}>
      {/* Conversation list */}
      <div
        className="w-64 flex-shrink-0 border-r overflow-y-auto p-3"
        style={{ borderColor: "var(--border-subtle)", backgroundColor: "var(--bg-surface)" }}
      >
        <div className="flex items-center justify-between mb-3 px-1">
          <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>Manager 会话</h2>
          <button
            onClick={loadConversations}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-opacity"
            style={{ border: "1px solid var(--border-subtle)", color: "var(--text-muted)" }}
            title="刷新"
          >🔄</button>
        </div>

        {loadingConv && <div className="text-xs px-1 py-3" style={{ color: "var(--text-muted)" }}>加载中...</div>}

        {!loadingConv && conversations.length === 0 && (
          <div className="text-xs px-1 py-6 text-center" style={{ color: "var(--text-muted)" }}>
            暂无 Manager 会话
          </div>
        )}

        <div className="space-y-1">
          {conversations.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveId(conv.id)}
              className="w-full text-left px-3 py-2 rounded-lg transition-colors"
              style={{
                backgroundColor: activeId === conv.id ? "var(--bg-overlay)" : "transparent",
                border: activeId === conv.id ? "1px solid var(--border-default)" : "1px solid transparent",
              }}
            >
              <div className="text-xs font-medium truncate" style={{ color: "var(--text-primary)" }}>{conv.title}</div>
              <div className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {conv.status} · {relativeTime(conv.updated_at)}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Contract detail */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            🤖 受控委托闭环
          </h1>
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>{contracts.length} 个契约</span>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-xl text-xs" style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
            ⚠️ {error}
          </div>
        )}

        {!activeId && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-5xl mb-4">🤖</div>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>从左侧选择一个 Manager 会话</div>
          </div>
        )}

        {loadingContracts && activeId && (
          <div className="text-xs py-3" style={{ color: "var(--text-muted)" }}>加载契约中...</div>
        )}

        {!loadingContracts && activeId && contracts.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="text-4xl mb-3">📋</div>
            <div className="text-sm" style={{ color: "var(--text-secondary)" }}>该会话暂无契约</div>
            <div className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
              在对话中让 Manager 起草 Worker 委托契约后会出现在这里
            </div>
          </div>
        )}

        <div className="space-y-3">
          {contracts.map((c) => {
            const st = STATUS_STYLE[c.status];
            const busy = busyId === c.contract_id;
            return (
              <div
                key={c.contract_id}
                className="rounded-xl p-4"
                style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{c.title}</span>
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-medium flex-shrink-0"
                        style={{ backgroundColor: st.bg, color: st.text, border: `1px solid ${st.border}` }}
                      >
                        {STATUS_LABEL[c.status]}
                      </span>
                    </div>
                    <p className="text-xs mb-1" style={{ color: "var(--text-secondary)" }}>{c.objective}</p>
                    <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
                      委托 Worker: {c.intended_worker} · 更新于 {relativeTime(c.updated_at)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 mt-3 flex-wrap">
                  {c.status === "draft" && (
                    <button
                      disabled={busy}
                      onClick={() => runAction(c.contract_id, () => setContractStatus(activeId!, c.contract_id, "ready_for_review", userId))}
                      className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-accent)", border: "1px solid var(--border-default)" }}
                    >
                      提交评审
                    </button>
                  )}
                  {c.status === "ready_for_review" && (
                    <button
                      disabled={busy}
                      onClick={() => runAction(c.contract_id, () => setContractStatus(activeId!, c.contract_id, "approved", userId))}
                      className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{ backgroundColor: "var(--accent-green)", color: "#fff" }}
                    >
                      ✓ 批准契约
                    </button>
                  )}
                  {c.status === "approved" && (
                    <button
                      disabled={busy}
                      onClick={() => runAction(c.contract_id, () => triggerAttempt(activeId!, c.contract_id, userId))}
                      className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                      style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-accent)", border: "1px solid var(--border-default)" }}
                    >
                      ▶ 触发执行
                    </button>
                  )}
                  {(c.status === "approved" || c.status === "ready_for_review") && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => runAction(c.contract_id, () => reviewContract(activeId!, c.contract_id, "accept_result", userId))}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{ backgroundColor: "rgba(16,185,129,0.15)", color: "#6ee7b7", border: "1px solid rgba(16,185,129,0.4)" }}
                      >
                        ✓ 接受结果
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => runAction(c.contract_id, () => reviewContract(activeId!, c.contract_id, "reject_result", userId))}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{ backgroundColor: "rgba(239,68,68,0.15)", color: "#fca5a5", border: "1px solid rgba(239,68,68,0.4)" }}
                      >
                        ✕ 拒绝
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => runAction(c.contract_id, () => reviewContract(activeId!, c.contract_id, "request_rerun", userId))}
                        className="px-3 py-1.5 rounded-md text-xs font-medium transition-colors"
                        style={{ backgroundColor: "var(--bg-elevated)", color: "var(--text-secondary)", border: "1px solid var(--border-subtle)" }}
                      >
                        ↻ 重新执行
                      </button>
                    </>
                  )}
                  {busy && <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>处理中...</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
