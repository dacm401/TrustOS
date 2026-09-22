"use client";

// MWT-6-UI — Memory Governance Surface v1.
//
// Renders the REAL MWT-6 governance output over the user's actual memory corpus
// (fetched from /v1/memory/governance, evaluated server-side by the MWT-6 core).
// This is the retention hook: memory is "alive" and shows its governance status
// (active / limited / expired / revoked / unverified / legacy / invalid) as it
// grows with use. Falls back to fixtures only on fetch error (honest degradation).

import { useEffect, useState } from "react";
import MemoryGovernancePanel from "./MemoryGovernancePanel";
import { allFixtures } from "./__fixtures__/memory-governance";
import { useAuth } from "@/contexts/AuthContext";
import {
  fetchMemoryGovernance,
  fetchMemories,
  confirmMemory,
  deleteMemory,
  updateMemory,
  fetchMemoryInjections,
  type MemoryGovernanceApiRecord,
  type MemoryEntryLite,
  type InjectionRecordLite,
  type MemorySensitivityTier,
} from "@/lib/api";
import type {
  MemoryGovernanceRecord,
  MemoryGovernanceStatus,
  MemoryScope,
  MemorySource,
  MemoryRetention,
  MemorySensitivity,
  TrustSpineRefs,
} from "@/types/memory-governance";

// ADR-004 阶段 B0：用户身份取自登录态，不再硬编码。
//
// 此前写死 `const DEV_USER = "dev-user"`，而真实数据挂在 `admin` 名下，
// 于是这个页面只能看到 1 条 dev-user 的记忆 —— 用户根本看不到系统为他
// 记住的另外 14 条。B0 的目标是「可见性」，身份错了就无从谈起。
const DEV_USER_FALLBACK = "dev-user";

function toFullRecord(r: MemoryGovernanceApiRecord, userId: string): MemoryGovernanceRecord {
  const trust_refs: TrustSpineRefs = {};
  return {
    memory_id: r.memory_id,
    content_digest: r.memory_id,
    // ADR-004 阶段 B0：带上正文，审核界面才看得到内容。
    content: r.content ?? "",
    category: r.category ?? "",
    importance: r.importance ?? 3,
    tags: r.tags ?? [],
    scope: r.scope as MemoryScope,
    source: r.source as MemorySource,
    created_at: r.created_at,
    created_by: userId,
    retention: r.retention as MemoryRetention,
    sensitivity: r.sensitivity as MemorySensitivity,
    expires_at: null,
    revoked_at: null,
    provenance_refs: [],
    evidence_refs: [],
    approval_refs: [],
    review_refs: [],
    trust_refs,
    note: null,
    status: r.status as MemoryGovernanceStatus,
    warnings: r.warnings ?? [],
    governance_fingerprint: r.governance_fingerprint,
    evaluated_at: r.evaluated_at,
  };
}

export default function MemoryGovernanceSurface() {
  const { user } = useAuth();
  // 与 app/page.tsx 一致：优先登录用户名，未登录时回退（此时后端会拒绝）。
  const userId = user?.username ?? DEV_USER_FALLBACK;

  const [records, setRecords] = useState<MemoryGovernanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Actionable governance (P1-2): pending queue + injections.
  const [pending, setPending] = useState<MemoryEntryLite[]>([]);
  const [injections, setInjections] = useState<InjectionRecordLite[]>([]);
  const [acting, setActing] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadActions = () => {
    fetchMemories(userId, { status: "pending", limit: 50 })
      .then((r) => setPending(r.entries ?? []))
      .catch(() => setPending([]));
    fetchMemoryInjections(userId, 10)
      .then((r) => setInjections(r.injections ?? []))
      .catch(() => setInjections([]));
  };

  const loadGovernance = () =>
    fetchMemoryGovernance(userId).then((res) => setRecords(res.records.map((r) => toFullRecord(r, userId))));

  useEffect(() => {
    let cancelled = false;
    loadGovernance()
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? "治理加载失败");
      });
    return () => {
      cancelled = true;
    };
    // userId 变化（登录/切换用户）必须重新拉取，否则仍会显示上一个用户的语料。
  }, [userId]);

  useEffect(() => {
    loadActions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const refresh = () => {
    loadActions();
    loadGovernance().catch(() => {});
  };

  // ADR-004 阶段 B0：把敏感度标记权交还给用户。
  // 这是 B1 过滤的唯一数据来源 —— 用户没标记的条目保持 unknown（不上云）。
  const handleSensitivityChange = (id: string, sensitivity: MemorySensitivityTier) => {
    void runAction(id, () => updateMemory(id, userId, { sensitivity }));
  };

  async function runAction(id: string, fn: () => Promise<unknown>) {
    setActing(id);
    setActionError(null);
    try {
      await fn();
      refresh();
    } catch (e: any) {
      setActionError(e?.message ?? "操作失败");
    } finally {
      setActing(null);
    }
  }

  const isLive = records !== null;
  const shown = isLive ? records! : allFixtures;

  // Provenance: auto-distilled entries carry rule:<name> and turn:<session>.
  function provenanceOf(tags: string[] = []): { rule?: string; turn?: string } {
    const rule = tags.find((t) => t.startsWith("rule:"))?.slice(5);
    const turn = tags.find((t) => t.startsWith("turn:"))?.slice(5);
    return { rule, turn };
  }

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="memory-governance-surface">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            🧠 记忆管理
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            系统记住了什么、来自哪里、是否允许发给云端模型。
            <strong>标记为「公开」的记忆才会被使用</strong>；未审阅的默认不上云。{" "}
            {isLive ? (
              <span className="text-emerald-600 font-medium">实时 · 共 {records!.length} 条</span>
            ) : (
              <span className="text-amber-600 font-medium">示例数据（加载失败：{error}）</span>
            )}
          </p>
        </div>

        {/* ── Pending queue: candidates the distiller was not confident
                enough to activate on its own. Nothing here reaches a prompt
                until confirmed — that is the whole point of "pending". ── */}
        <div className="rounded-xl border p-4" style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: pending.length > 0 ? "var(--accent-amber, #d97706)" : "var(--border-subtle)",
        }}>
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
              ⏳ 待确认记忆（{pending.length}）
            </h2>
            <button
              type="button"
              onClick={refresh}
              className="px-2 py-0.5 rounded text-[10px]"
              style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
            >
              刷新
            </button>
          </div>

          {actionError && (
            <div className="mb-2 px-2 py-1 rounded text-xs"
              style={{ backgroundColor: "rgba(239,68,68,0.1)", color: "var(--accent-red)" }}>
              ⚠️ {actionError}
            </div>
          )}

          {pending.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              暂无待确认条目。低置信度的自动提取会先进入这里，经你确认后才会参与注入。
            </p>
          ) : (
            <div className="vlist space-y-2">
              {pending.map((m) => {
                const prov = provenanceOf(m.tags ?? []);
                return (
                  <div key={m.id} className="rounded-lg border p-2 text-xs"
                    style={{ borderColor: "var(--border-subtle)" }}>
                    <div style={{ color: "var(--text-primary)" }}>{m.content}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2" style={{ color: "var(--text-muted)" }}>
                      <span>{m.category}</span>
                      {prov.rule && <span>· 规则 {prov.rule}</span>}
                      {prov.turn && <span>· 会话 {prov.turn.slice(0, 12)}…</span>}
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button
                        type="button"
                        disabled={acting === m.id}
                        onClick={() => runAction(m.id, () => confirmMemory(m.id, userId))}
                        className="px-2 py-0.5 rounded text-[10px]"
                        style={{ border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}
                      >
                        {acting === m.id ? "处理中…" : "✓ 确认"}
                      </button>
                      <button
                        type="button"
                        disabled={acting === m.id}
                        onClick={() => runAction(m.id, () => deleteMemory(m.id, userId))}
                        className="px-2 py-0.5 rounded text-[10px]"
                        style={{ border: "1px solid var(--border-subtle)", color: "var(--accent-red)" }}
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="vlist space-y-4">
          {shown.map((record) => (
            <MemoryGovernancePanel
              key={record.memory_id}
              record={record}
              onSensitivityChange={handleSensitivityChange}
              disabled={acting === record.memory_id}
            />
          ))}
        </div>

        {/* ── Injection transparency: which memories recent turns used ── */}
        <div className="rounded-xl border p-4 text-xs" style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}>
          <h2 className="text-sm font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            🔍 最近注入（{injections.length}）
          </h2>
          {injections.length === 0 ? (
            <p style={{ color: "var(--text-muted)" }}>
              暂无记录。发起一次对话后，这里会显示每轮实际使用了哪些记忆。
            </p>
          ) : (
            <div className="space-y-2">
              {injections.slice(0, 6).map((inj, i) => (
                <div key={`${inj.at}-${i}`} className="rounded-lg border p-2"
                  style={{ borderColor: "var(--border-subtle)" }}>
                  <div style={{ color: "var(--text-secondary)" }}>
                    {new Date(inj.at).toLocaleTimeString()} · {inj.method} · ≈{inj.approxTokens} tokens
                    {inj.truncated && <span style={{ color: "var(--accent-amber, #d97706)" }}> · 已截断</span>}
                  </div>
                  {inj.memories.length === 0 ? (
                    <div style={{ color: "var(--text-muted)" }}>（本轮未注入任何记忆）</div>
                  ) : (
                    <ul className="mt-1 space-y-0.5" style={{ color: "var(--text-secondary)" }}>
                      {inj.memories.map((m) => (
                        <li key={m.id}>
                          · [{m.rule}] {m.category} · 相关度 {m.relevance.toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Honest status legend */}
        <div className="rounded-xl border p-4 text-xs" style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}>
          <div className="font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Status Legend
          </div>
          <ul className="space-y-1" style={{ color: "var(--text-secondary)" }}>
            <li>
              <span className="text-emerald-600 font-medium">Active</span> — governed, usable.
            </li>
            <li>
              <span className="text-amber-600 font-medium">Limited</span> — usable but with
              caution (sensitive / unknown sensitivity).
            </li>
            <li>
              <span className="text-amber-600 font-medium">Expired / Legacy / Unverified</span> —
              not fully trusted.
            </li>
            <li>
              <span className="text-red-600 font-medium">Revoked / Invalid</span> — do not treat
              as active or safe.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
