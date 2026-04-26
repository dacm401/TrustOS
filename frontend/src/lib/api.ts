// 获取API配置
export function getApiConfig() {
  const DEFAULT_API_BASE = "http://localhost:3001";
  if (typeof window !== "undefined") {
    // 强制纠正：不允许 api_url 指向外部 API，只能是本地后端
    const storedUrl = localStorage.getItem("api_url");
    if (storedUrl && storedUrl !== DEFAULT_API_BASE) {
      localStorage.setItem("api_url", DEFAULT_API_BASE);
    }
    return {
      apiBase: DEFAULT_API_BASE,
      apiKey: localStorage.getItem("api_key") || "",
      fastModel: localStorage.getItem("fast_model") || "Qwen/Qwen2.5-7B-Instruct",
      slowModel: localStorage.getItem("slow_model") || "deepseek-ai/DeepSeek-V3",
    };
  }
  return {
    apiBase: process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE,
    apiKey: "",
    fastModel: "Qwen/Qwen2.5-7B-Instruct",
    slowModel: "deepseek-ai/DeepSeek-V3",
  };
}

/** Exported so components can build streaming fetch URLs directly */
export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

// ── Auth helpers ──────────────────────────────────────────────────────────────

function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("srp_jwt_token");
}

function buildHeaders(extra?: Record<string, string>): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = extra ?? {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

export async function sendMessage(message: string, history: any[], userId: string, sessionId: string) {
  const { apiBase, apiKey, fastModel, slowModel } = getApiConfig();
  const body: Record<string, any> = { user_id: userId, session_id: sessionId, message, history };
  // 如果前端设置里有 Key / 模型，透传给后端覆盖环境变量
  if (apiKey) body.api_key = apiKey;
  if (fastModel) body.fast_model = fastModel;
  if (slowModel) body.slow_model = slowModel;

  const res = await fetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildHeaders() },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `服务器错误 (${res.status})`);
  }
  return data;
}

export async function getDashboard(userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/dashboard/${userId}`, {
    headers: buildHeaders(),
  });
  return res.json();
}

export async function getGrowth(userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/growth/${userId}`, {
    headers: buildHeaders(),
  });
  return res.json();
}

export async function sendFeedback(decisionId: string, type: string, userId: string) {
  const { apiBase } = getApiConfig();
  await fetch(`${apiBase}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildHeaders() },
    body: JSON.stringify({ decision_id: decisionId, feedback_type: type, user_id: userId }),
  });
}

// UI1: Workbench panels API helpers
// NOTE: tasks and evidence live under /v1/* (backend index.ts app.route("/v1/tasks/...", taskRouter))

export async function fetchTasks(userId: string, sessionId?: string) {
  const { apiBase } = getApiConfig();
  const url = sessionId
    ? `${apiBase}/v1/tasks/all?session_id=${encodeURIComponent(sessionId)}`
    : `${apiBase}/v1/tasks/all`;
  const res = await fetch(url, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载任务列表失败 (${res.status})`);
  return res.json();
}

export async function fetchTaskDetail(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载任务详情失败 (${res.status})`);
  return res.json();
}

export async function fetchTaskSummary(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/summary`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载任务摘要失败 (${res.status})`);
  return res.json();
}

export async function fetchEvidence(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/evidence?task_id=${encodeURIComponent(taskId)}`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载证据列表失败 (${res.status})`);
  return res.json();
}

export async function fetchTraces(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/traces`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载执行轨迹失败 (${res.status})`);
  return res.json();
}

// H1: Runtime Health Dashboard
export interface HealthStatus {
  status: "ok" | "degraded" | "error";
  timestamp: string;
  uptime_seconds: number;
  version: string;
  services: {
    database: { status: "ok" | "error"; latency_ms: number | null };
    model_router: { status: "ok" | "error"; providers: string[] };
    web_search: { status: "configured" | "not_configured" };
  };
  stats: {
    tasks_total: number;
    tasks_active: number;
    memory_entries: number;
    evidence_total: number;
  } | null;
}

export async function fetchHealth(): Promise<HealthStatus> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/health`, {
    headers: buildHeaders(),
  });
  if (!res.ok) throw new Error(`加载健康状态失败 (${res.status})`);
  return res.json();
}

// Memory API helpers
export interface MemoryEntry {
  id: string;
  category: string;
  content: string;
  source: string | null;
  created_at: string;
  relevance_score?: number;
}

export async function fetchMemory(userId: string, category?: string): Promise<{ entries: MemoryEntry[] }> {
  const { apiBase } = getApiConfig();
  const url = category
    ? `${apiBase}/v1/memory?category=${encodeURIComponent(category)}`
    : `${apiBase}/v1/memory`;
  const res = await fetch(url, { headers: { "X-User-Id": userId, ...buildHeaders() } });
  if (!res.ok) throw new Error(`加载记忆列表失败 (${res.status})`);
  return res.json() as Promise<{ entries: MemoryEntry[] }>;
}

export async function deleteMemory(id: string, userId: string): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`删除记忆失败 (${res.status})`);
}

export async function createMemoryEntry(
  userId: string,
  category: string,
  content: string,
  source: string = "manual"
): Promise<MemoryEntry> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
    body: JSON.stringify({ category, content, source }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `添加记忆失败 (${res.status})`);
  }
  const data = await res.json();
  return data.entry as MemoryEntry;
}

export async function fetchDecision(taskId: string, userId: string) {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/decision`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载决策数据失败 (${res.status})`);
  return res.json();
}

export async function patchTask(taskId: string, userId: string, action: "resume" | "pause" | "cancel"): Promise<boolean> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
    body: JSON.stringify({ action }),
  });
  return res.ok;
}

export interface CostStats {
  total_spent_usd: number;
  baseline_spent_usd: number;
  saved_usd: number;
  saved_percent: number;
  task_count: number;
  period_days: number;
}

export async function fetchCostStats(userId: string): Promise<CostStats> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/cost-stats/${encodeURIComponent(userId)}`, {
    headers: buildHeaders(),
  });
  if (!res.ok) throw new Error(`加载成本统计失败 (${res.status})`);
  return res.json() as Promise<CostStats>;
}

// G4: Delegation logs API helpers
export interface DelegationLog {
  id: string;
  routed_action: string;
  routing_reason: string | null;
  g2_final_action: string | null;
  g3_final_action: string | null;
  did_rerank: boolean;
  llm_confidence: number;
  system_confidence: number;
  execution_status: string | null;
  execution_correct: boolean | null;
  routing_success: boolean | null;
  value_success: boolean | null;
  user_success: boolean | null;
  latency_ms: number | null;
  cost_usd: number | null;
  model_used: string | null;
  created_at: string;
  executed_at: string | null;
}

export interface DelegationStats {
  metrics: {
    total_decisions: number;
    action_distribution: Record<string, number>;
    execution_success_rate: number;
    avg_latency_ms: number;
    avg_cost_usd: number;
    rerank_stats: { rate: number; correction_rate: number };
    routing_agreement_rate: number;
  };
  rerankStats: {
    total: number;
    rerank_count: number;
    rerank_rate: number;
    corrected_count: number;
    correction_rate: number;
  };
  actionDistribution: Record<string, number>;
}

export async function fetchDelegationLogs(userId: string, limit = 50, offset = 0): Promise<{ logs: DelegationLog[]; limit: number; offset: number }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/delegation-logs/${encodeURIComponent(userId)}?limit=${limit}&offset=${offset}`, {
    headers: buildHeaders(),
  });
  if (!res.ok) throw new Error(`加载委托日志失败 (${res.status})`);
  return res.json();
}

export async function fetchDelegationStats(userId: string): Promise<DelegationStats> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/api/delegation-stats/${encodeURIComponent(userId)}`, {
    headers: buildHeaders(),
  });
  if (!res.ok) throw new Error(`加载委托统计失败 (${res.status})`);
  return res.json();
}

// ── Sprint 66: Permissions & Workspaces ──────────────────────────────────────

export interface PermissionRequest {
  id: string;
  task_id: string;
  worker_id: string;
  user_id: string;
  session_id: string;
  field_name: string;
  field_key: string;
  purpose: string;
  value_preview?: string;
  status: "pending" | "approved" | "denied" | "expired";
  expires_in: number;
  approved_scope?: string;
  created_at: string;
  resolved_at?: string;
  resolved_by?: string;
}

export interface TaskWorkspace {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;
  objective: string;
  constraints: string[];
  shared_outputs: Record<string, unknown>;
  access_log: any[];
  created_at: string;
  updated_at: string;
}

export async function fetchPendingPermissions(userId: string): Promise<{ requests: PermissionRequest[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/permissions/pending`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载待审批权限失败 (${res.status})`);
  return res.json();
}

export async function fetchPermissionsByTask(taskId: string, userId: string): Promise<{ requests: PermissionRequest[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/permissions/task/${encodeURIComponent(taskId)}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载任务权限失败 (${res.status})`);
  return res.json();
}

export async function approvePermission(id: string, userId: string, approvedScope?: string): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/permissions/${encodeURIComponent(id)}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
    body: JSON.stringify({ approved_scope: approvedScope }),
  });
  if (!res.ok) throw new Error(`授权失败 (${res.status})`);
}

export async function denyPermission(id: string, userId: string): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/permissions/${encodeURIComponent(id)}/deny`, {
    method: "POST",
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`拒绝失败 (${res.status})`);
}

export async function fetchActiveWorkspaces(userId: string): Promise<{ workspaces: TaskWorkspace[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/workspaces`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载工作区失败 (${res.status})`);
  return res.json();
}

export async function fetchWorkspaceByTask(taskId: string, userId: string): Promise<{ workspace: TaskWorkspace | null }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/workspaces/${encodeURIComponent(taskId)}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载工作区详情失败 (${res.status})`);
  return res.json();
}
