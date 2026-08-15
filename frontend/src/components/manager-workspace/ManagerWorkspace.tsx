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
  fetchTrustRefs,
  attachTrustRef,
  detachTrustRef,
  fetchContracts,
  createContract,
  updateContract,
  setContractStatus,
  deleteContract,
  fetchAttempts,
  createAttempt,
  cancelAttempt,
  fetchReviews,
  createReview,
  type ManagerConversationRecord,
  type MemoryRefRecord,
  type TrustRefRecord,
  type TrustRefKind,
  type WorkerDelegationContract,
  type ContractStatus,
  type WorkerExecutionAttempt,
  type ExecutionMode,
  type AttemptStatus,
  type ManagerReviewRecord,
  type ReviewTargetType,
  type ReviewDecision,
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

// MWT-16: Manager ↔ Trust Evidence Bridge — read-only audit/observational references.
// Shows trust evidence references attached to a manager conversation. These are
// OBSERVATIONAL/audit links (trace/event/evidence/task/run IDs + safe metadata), NOT
// proof of full Private Beta READY. UI makes this explicit so the user understands
// the references are context links, not autonomous verification. No raw event payload
// or raw evidence content is exposed.
const TRUST_REF_KINDS: TrustRefKind[] = ["evidence", "trace", "event", "task", "run"];

function TrustEvidencePanel({
  userId,
  conversationId,
}: {
  userId: string;
  conversationId: string | null;
}) {
  const [refs, setRefs] = useState<TrustRefRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kind, setKind] = useState<TrustRefKind>("evidence");
  const [refId, setRefId] = useState("");

  const loadRefs = useCallback(() => {
    if (!conversationId) return;
    setLoading(true);
    fetchTrustRefs(userId, conversationId)
      .then((data) => setRefs(data.trust_refs ?? []))
      .catch(() => setRefs([]))
      .finally(() => setLoading(false));
  }, [userId, conversationId]);

  useEffect(() => {
    loadRefs();
  }, [loadRefs]);

  const handleAttach = useCallback(async () => {
    if (!conversationId || !refId.trim()) return;
    try {
      await attachTrustRef(userId, conversationId, kind, refId.trim());
      setRefId("");
      setPickerOpen(false);
      loadRefs();
    } catch {
      /* silent */
    }
  }, [userId, conversationId, kind, refId, loadRefs]);

  const handleDetach = useCallback(async (r: TrustRefRecord) => {
    if (!conversationId) return;
    try {
      await detachTrustRef(userId, conversationId, r.ref_kind, r.ref_id);
      loadRefs();
    } catch {
      /* silent */
    }
  }, [userId, conversationId, loadRefs]);

  if (!conversationId) {
    return (
      <div className="px-3 py-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        选择一个会话后可查看信任证据引用
      </div>
    );
  }

  return (
    <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          信任证据引用
        </span>
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            backgroundColor: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          + 关联证据
        </button>
      </div>
      <div className="text-[9px] mb-1.5" style={{ color: "var(--text-faint)" }}>
        观测/审计引用（只读），不是 Private Beta READY 证明
      </div>

      {loading && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>加载中…</div>}
      {!loading && refs.length === 0 && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>暂无引用</div>
      )}
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {refs.map((r) => (
          <div
            key={`${r.ref_kind}:${r.ref_id}`}
            className="text-[10px] rounded px-2 py-1"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          >
            <div className="flex items-center justify-between">
              <span className="font-mono truncate" style={{ maxWidth: "110px" }}>
                {r.ref_kind}:{r.ref_id.slice(0, 10)}
              </span>
              <button
                onClick={() => handleDetach(r)}
                className="text-[9px]"
                style={{ color: "var(--text-faint)" }}
                title="取消关联"
              >
                解绑
              </button>
            </div>
            {r.ref_kind === "evidence" && (
              <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
                {r.source ?? ""}
                {r.relevance_score != null ? ` · score ${r.relevance_score}` : ""}
                {r.related_task_id ? ` · task ${r.related_task_id.slice(0, 8)}` : ""}
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
              关联信任证据（引用，不复制内容）
            </span>
            <button onClick={() => setPickerOpen(false)} className="text-[9px]" style={{ color: "var(--text-faint)" }}>
              关闭
            </button>
          </div>
          <div className="flex gap-1 mb-1">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as TrustRefKind)}
              className="text-[10px] rounded px-1 py-0.5"
              style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
            >
              {TRUST_REF_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <input
              value={refId}
              onChange={(e) => setRefId(e.target.value)}
              placeholder="ref id"
              className="flex-1 text-[10px] rounded px-1 py-0.5"
              style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
            />
            <button
              onClick={handleAttach}
              className="text-[10px] px-2 py-0.5 rounded"
              style={{ backgroundColor: "var(--accent-blue)", color: "white" }}
            >
              关联
            </button>
          </div>
          <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
            evidence 引用会做归属校验；trace/event/task/run 为关联链接
          </div>
        </div>
      )}
    </div>
  );
}

// MWT-17: Worker Delegation Contract — explicit, reviewable contract layer.
// This panel lets the Manager prepare a structured worker delegation contract:
// what to delegate, to which worker/capability, inputs, constraints, expected
// output, and review status. It is NON-EXECUTING: no worker is invoked, no
// autonomous loop, no scheduling. A contract is intent, not completed work and
// not proof of Private Beta READY.
const CONTRACT_STATUSES: ContractStatus[] = [
  "draft",
  "ready_for_review",
  "approved",
  "rejected",
  "superseded",
];

function WorkerDelegationPanel({
  userId,
  conversationId,
}: {
  userId: string;
  conversationId: string | null;
}) {
  const [contracts, setContracts] = useState<WorkerDelegationContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [creatorOpen, setCreatorOpen] = useState(false);

  // draft form state
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [intendedWorker, setIntendedWorker] = useState("");
  const [inputSummary, setInputSummary] = useState("");
  const [constraints, setConstraints] = useState("");
  const [expectedOutput, setExpectedOutput] = useState("");

  const loadContracts = useCallback(() => {
    if (!conversationId) return;
    setLoading(true);
    fetchContracts(userId, conversationId)
      .then((data) => setContracts(data.contracts ?? []))
      .catch(() => setContracts([]))
      .finally(() => setLoading(false));
  }, [userId, conversationId]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  const resetForm = useCallback(() => {
    setTitle("");
    setObjective("");
    setIntendedWorker("");
    setInputSummary("");
    setConstraints("");
    setExpectedOutput("");
  }, []);

  const handleCreate = useCallback(async () => {
    if (!conversationId || !title.trim() || !objective.trim()) return;
    try {
      await createContract(userId, conversationId, {
        title: title.trim(),
        objective: objective.trim(),
        intended_worker: intendedWorker.trim() || null,
        input_summary: inputSummary.trim() || null,
        constraints: constraints.trim() || null,
        expected_output: expectedOutput.trim() || null,
      });
      setCreatorOpen(false);
      resetForm();
      loadContracts();
    } catch {
      /* silent */
    }
  }, [
    userId,
    conversationId,
    title,
    objective,
    intendedWorker,
    inputSummary,
    constraints,
    expectedOutput,
    resetForm,
    loadContracts,
  ]);

  const handleSetStatus = useCallback(
    async (c: WorkerDelegationContract, status: ContractStatus) => {
      if (!conversationId) return;
      try {
        await setContractStatus(userId, conversationId, c.contract_id, status);
        loadContracts();
      } catch {
        /* silent */
      }
    },
    [userId, conversationId, loadContracts]
  );

  const handleDelete = useCallback(
    async (c: WorkerDelegationContract) => {
      if (!conversationId) return;
      try {
        await deleteContract(userId, conversationId, c.contract_id);
        loadContracts();
      } catch {
        /* silent */
      }
    },
    [userId, conversationId, loadContracts]
  );

  const statusColor: Record<ContractStatus, string> = {
    draft: "var(--text-muted)",
    ready_for_review: "var(--accent-blue)",
    approved: "var(--accent-green)",
    rejected: "var(--text-faint)",
    superseded: "var(--text-faint)",
  };

  if (!conversationId) {
    return (
      <div className="px-3 py-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        选择一个会话后可创建委派合同
      </div>
    );
  }

  return (
    <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] font-medium" style={{ color: "var(--text-muted)" }}>
          委派合同
        </span>
        <button
          onClick={() => setCreatorOpen((v) => !v)}
          className="text-[10px] px-2 py-0.5 rounded"
          style={{
            backgroundColor: "var(--bg-overlay)",
            color: "var(--text-secondary)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          + 新建合同
        </button>
      </div>
      <div className="text-[9px] mb-1.5" style={{ color: "var(--text-faint)" }}>
        委派意图层（不执行、不自动运行），不是 Private Beta READY 证明
      </div>

      {loading && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>加载中…</div>}
      {!loading && contracts.length === 0 && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>暂无合同</div>
      )}
      <div className="space-y-1 max-h-44 overflow-y-auto">
        {contracts.map((c) => (
          <div
            key={c.contract_id}
            className="text-[10px] rounded px-2 py-1"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          >
            <div className="flex items-center justify-between">
              <span className="font-medium truncate" style={{ maxWidth: "160px" }}>
                {c.title}
              </span>
              <span
                className="text-[9px] px-1 rounded"
                style={{ color: statusColor[c.status], border: `1px solid ${statusColor[c.status]}` }}
              >
                {c.status}
              </span>
            </div>
            <div className="truncate" style={{ color: "var(--text-muted)" }}>{c.objective}</div>
            {c.intended_worker && (
              <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
                委派给: {c.intended_worker}
              </div>
            )}
            <div className="flex flex-wrap gap-1 mt-1">
              {c.status === "draft" && (
                <>
                  <button
                    onClick={() => handleSetStatus(c, "ready_for_review")}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: "var(--accent-blue)", color: "#fff" }}
                  >
                    提交审核
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ color: "var(--text-faint)", border: "1px solid var(--border-subtle)" }}
                  >
                    删除草稿
                  </button>
                </>
              )}
              {c.status === "ready_for_review" && (
                <>
                  <button
                    onClick={() => handleSetStatus(c, "approved")}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: "var(--accent-green)", color: "#fff" }}
                  >
                    批准
                  </button>
                  <button
                    onClick={() => handleSetStatus(c, "rejected")}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ color: "var(--text-faint)", border: "1px solid var(--border-subtle)" }}
                  >
                    驳回
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>

      {creatorOpen && (
        <div
          className="mt-2 rounded p-2 space-y-1"
          style={{ backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-subtle)" }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px]" style={{ color: "var(--text-secondary)" }}>
              新建委派合同（仅记录意图，不执行）
            </span>
            <button onClick={() => setCreatorOpen(false)} className="text-[9px]" style={{ color: "var(--text-faint)" }}>
              关闭
            </button>
          </div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="标题 *"
            className="w-full text-[10px] rounded px-1 py-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          />
          <textarea
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            placeholder="目标 / 委派原因 *"
            rows={2}
            className="w-full text-[10px] rounded px-1 py-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          />
          <input
            value={intendedWorker}
            onChange={(e) => setIntendedWorker(e.target.value)}
            placeholder="委派给 (worker/capability)"
            className="w-full text-[10px] rounded px-1 py-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          />
          <textarea
            value={inputSummary}
            onChange={(e) => setInputSummary(e.target.value)}
            placeholder="输入摘要 / 上下文"
            rows={2}
            className="w-full text-[10px] rounded px-1 py-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          />
          <textarea
            value={constraints}
            onChange={(e) => setConstraints(e.target.value)}
            placeholder="约束 / 允许范围"
            rows={2}
            className="w-full text-[10px] rounded px-1 py-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          />
          <textarea
            value={expectedOutput}
            onChange={(e) => setExpectedOutput(e.target.value)}
            placeholder="期望输出 / 完成标准"
            rows={2}
            className="w-full text-[10px] rounded px-1 py-0.5"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          />
          <button
            onClick={handleCreate}
            disabled={!title.trim() || !objective.trim()}
            className="text-[10px] px-2 py-0.5 rounded disabled:opacity-50"
            style={{ backgroundColor: "var(--accent-blue)", color: "#fff" }}
          >
            创建草稿
          </button>
        </div>
      )}
    </div>
  );
}

// MWT-18: Controlled Worker Execution Harness — creates a CONTROLLED execution
// attempt ONLY from an APPROVED Worker Delegation Contract. The attempt is local
// and deterministic: it runs NO real worker, NO live gateway, NO network, NO
// scheduling, NO autonomous loop. The result summary is explicitly labeled as
// local harness output, NOT live evidence and NOT proof of real-world completion.
const ATTEMPT_STATUSES: AttemptStatus[] = [
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
];

function WorkerExecutionPanel({
  userId,
  conversationId,
}: {
  userId: string;
  conversationId: string | null;
}) {
  const [attempts, setAttempts] = useState<WorkerExecutionAttempt[]>([]);
  const [contracts, setContracts] = useState<WorkerDelegationContract[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<ExecutionMode>("deterministic_local");

  const approvedContracts = useMemo(
    () => contracts.filter((c) => c.status === "approved"),
    [contracts]
  );

  // Load approved contracts (contract gate source) for this conversation.
  useEffect(() => {
    if (!conversationId) {
      setContracts([]);
      return;
    }
    fetchContracts(userId, conversationId)
      .then((data) => setContracts(data.contracts ?? []))
      .catch(() => setContracts([]));
  }, [userId, conversationId]);

  const loadAttempts = useCallback(() => {
    if (!conversationId) return;
    setLoading(true);
    fetchAttempts(userId, conversationId)
      .then((data) => setAttempts(data.attempts ?? []))
      .catch(() => setAttempts([]))
      .finally(() => setLoading(false));
  }, [userId, conversationId]);

  useEffect(() => {
    loadAttempts();
  }, [loadAttempts]);

  const handleRun = useCallback(
    async (contractId: string) => {
      if (!conversationId) return;
      try {
        await createAttempt(userId, conversationId, contractId, mode);
        loadAttempts();
      } catch {
        /* silent */
      }
    },
    [userId, conversationId, mode, loadAttempts]
  );

  const handleCancel = useCallback(
    async (a: WorkerExecutionAttempt) => {
      if (!conversationId) return;
      try {
        await cancelAttempt(userId, conversationId, a.attempt_id);
        loadAttempts();
      } catch {
        /* silent */
      }
    },
    [userId, conversationId, loadAttempts]
  );

  const statusColor: Record<AttemptStatus, string> = {
    queued: "var(--text-muted)",
    running: "var(--accent-blue)",
    completed: "var(--accent-green)",
    failed: "var(--text-faint)",
    cancelled: "var(--text-faint)",
  };

  if (!conversationId) {
    return (
      <div className="px-3 py-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        选择一个会话后可查看执行尝试
      </div>
    );
  }

  return (
    <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
        执行尝试（受控 harness）
      </div>
      <div className="text-[9px] mb-1.5" style={{ color: "var(--text-faint)" }}>
        仅从已批准合同创建 · 本地确定性输出 · 非真实执行 · 非 Private Beta READY 证明
      </div>

      {/* Contract gate: only approved contracts may spawn attempts */}
      <div className="mb-1.5">
        <span className="text-[9px]" style={{ color: "var(--text-faint)" }}>执行模式: </span>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value as ExecutionMode)}
          className="text-[9px] rounded px-1 py-0.5"
          style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
        >
          <option value="deterministic_local">deterministic_local</option>
          <option value="dry_run">dry_run</option>
          <option value="manual_placeholder">manual_placeholder</option>
        </select>
      </div>

      {approvedContracts.length === 0 && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          无已批准合同 → 无法创建执行尝试（合同门禁）
        </div>
      )}
      {approvedContracts.map((c) => (
        <div key={c.contract_id} className="flex items-center justify-between mb-1">
          <span className="text-[10px] truncate" style={{ color: "var(--text-secondary)", maxWidth: "180px" }}>
            {c.title}
          </span>
          <button
            onClick={() => handleRun(c.contract_id)}
            className="text-[9px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: "var(--accent-green)", color: "#fff" }}
          >
            创建尝试
          </button>
        </div>
      ))}

      {loading && <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>加载中…</div>}
      {!loading && attempts.length === 0 && (
        <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>暂无执行尝试</div>
      )}
      <div className="space-y-1 max-h-44 overflow-y-auto mt-1">
        {attempts.map((a) => (
          <div
            key={a.attempt_id}
            className="text-[10px] rounded px-2 py-1"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          >
            <div className="flex items-center justify-between">
              <span className="truncate" style={{ maxWidth: "150px" }}>
                {a.worker_label ?? "worker"}
              </span>
              <span
                className="text-[9px] px-1 rounded"
                style={{ color: statusColor[a.status], border: `1px solid ${statusColor[a.status]}` }}
              >
                {a.status}
              </span>
            </div>
            <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
              模式: {a.execution_mode}
            </div>
            {a.result_summary && (
              <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {a.result_summary}
              </div>
            )}
            {(a.status === "queued" || a.status === "running") && (
              <button
                onClick={() => handleCancel(a)}
                className="text-[9px] px-1.5 py-0.5 rounded mt-1"
                style={{ color: "var(--text-faint)", border: "1px solid var(--border-subtle)" }}
              >
                取消
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// MWT-19: Manager Review / Approve Loop — internal manager review panel.
// Records explicit human/manager review decisions for contracts (approve/reject/request_changes)
// and execution attempts (accept_result/reject_result/request_rerun). UI makes explicit that
// this is INTERNAL manager review, NOT external beta reviewer evidence and NOT a Private Beta
// READY proof. Review records are additive/auditable; they do not mutate contract/attempt state.
const CONTRACT_DECISIONS: ReviewDecision[] = ["approve", "reject", "request_changes"];
const ATTEMPT_DECISIONS: ReviewDecision[] = ["accept_result", "reject_result", "request_rerun"];

function ReviewPanel({
  userId,
  conversationId,
}: {
  userId: string;
  conversationId: string | null;
}) {
  const [reviews, setReviews] = useState<ManagerReviewRecord[]>([]);
  const [targetType, setTargetType] = useState<ReviewTargetType>("delegation_contract");
  const [targetId, setTargetId] = useState<string>("");
  const [decision, setDecision] = useState<ReviewDecision>("approve");
  const [reason, setReason] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReviews = useCallback(() => {
    if (!conversationId) return;
    fetchReviews(userId, conversationId)
      .then((data) => setReviews(data.reviews ?? []))
      .catch(() => setReviews([]));
  }, [userId, conversationId]);

  useEffect(() => {
    loadReviews();
  }, [loadReviews]);

  const handleCreate = useCallback(async () => {
    if (!conversationId || !targetId) {
      setError("请选择目标（合同或执行尝试）");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createReview(userId, conversationId, targetType, targetId, decision, reason || undefined);
      setReason("");
      loadReviews();
    } catch (e: any) {
      setError(e?.message ?? "创建评审记录失败");
    } finally {
      setBusy(false);
    }
  }, [userId, conversationId, targetType, targetId, decision, reason, loadReviews]);

  if (!conversationId) {
    return (
      <div className="px-3 py-2 text-[10px]" style={{ color: "var(--text-muted)" }}>
        选择一个会话后可查看评审记录
      </div>
    );
  }

  const decisions = targetType === "delegation_contract" ? CONTRACT_DECISIONS : ATTEMPT_DECISIONS;

  return (
    <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
      <div className="text-[11px] font-medium mb-1" style={{ color: "var(--text-muted)" }}>
        经理评审 / 审批循环
        <span className="ml-1.5 rounded px-1 py-0.5 text-[9px]" style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-faint)" }}>
          内部经理评审 · 非 beta 评审证据
        </span>
      </div>
      <div className="text-[9px] mb-1.5" style={{ color: "var(--text-faint)" }}>
        记录对合同与执行尝试的人工评审决策 · 仅追加审计 · 非真实完成证明 · 非 Private Beta READY
      </div>

      <div className="flex items-center gap-1 mb-1">
        <select
          value={targetType}
          onChange={(e) => { setTargetType(e.target.value as ReviewTargetType); setTargetId(""); setDecision(targetType === "delegation_contract" ? "approve" : "accept_result"); }}
          className="text-[9px] rounded px-1 py-0.5"
          style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
        >
          <option value="delegation_contract">合同</option>
          <option value="execution_attempt">执行尝试</option>
        </select>
        <input
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
          placeholder="目标 ID"
          className="text-[9px] rounded px-1 py-0.5 flex-1"
          style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
        />
      </div>

      <div className="flex items-center gap-1 mb-1">
        <select
          value={decision}
          onChange={(e) => setDecision(e.target.value as ReviewDecision)}
          className="text-[9px] rounded px-1 py-0.5"
          style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
        >
          {decisions.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <button
          onClick={handleCreate}
          disabled={busy || !targetId}
          className="text-[9px] px-1.5 py-0.5 rounded disabled:opacity-40"
          style={{ backgroundColor: "var(--accent-purple)", color: "#fff" }}
        >
          {busy ? "记录中…" : "记录评审"}
        </button>
      </div>

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="评审理由（安全文本，仅记录评论）"
        className="text-[9px] rounded px-1 py-0.5 w-full mb-1"
        style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
      />

      {error && <div className="text-[9px] mb-1" style={{ color: "var(--text-error)" }}>{error}</div>}

      <div className="text-[9px] mb-1" style={{ color: "var(--text-faint)" }}>评审历史（按时间）</div>
      <div className="space-y-1 max-h-40 overflow-y-auto">
        {reviews.length === 0 && (
          <div className="text-[10px]" style={{ color: "var(--text-muted)" }}>暂无评审记录</div>
        )}
        {reviews.map((r) => (
          <div
            key={r.review_id}
            className="text-[9px] rounded px-2 py-1"
            style={{ backgroundColor: "var(--bg-overlay)", color: "var(--text-secondary)" }}
          >
            <div className="flex items-center justify-between">
              <span className="truncate" style={{ maxWidth: "150px" }}>{r.decision}</span>
              <span style={{ color: "var(--text-faint)" }}>
                {r.target_type === "delegation_contract" ? "合同" : "尝试"}:{r.target_id}
              </span>
            </div>
            {r.reason && <div className="text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }}>{r.reason}</div>}
            <div className="text-[9px]" style={{ color: "var(--text-faint)" }}>
              {new Date(r.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </div>
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
        <TrustEvidencePanel userId={userId} conversationId={selectedConversationId} />
        <WorkerDelegationPanel userId={userId} conversationId={selectedConversationId} />
        <WorkerExecutionPanel userId={userId} conversationId={selectedConversationId} />
        <ReviewPanel userId={userId} conversationId={selectedConversationId} />
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
