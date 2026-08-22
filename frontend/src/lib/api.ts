const RAW_API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3002").trim();
const DEFAULT_API_BASE = RAW_API_BASE || "http://localhost:3002";

// 获取API配置
export function getApiConfig() {
  if (typeof window !== "undefined") {
    // 强制纠正：不允许 api_url 指向外部 API，只能是本地后端
    const storedUrl = localStorage.getItem("api_url");
    if (storedUrl && storedUrl.trim() !== DEFAULT_API_BASE) {
      localStorage.setItem("api_url", DEFAULT_API_BASE);
    }
    return {
      apiBase: DEFAULT_API_BASE,
      apiKey: localStorage.getItem("api_key") || "",
      fastModel: localStorage.getItem("fast_model") || "Qwen/Qwen2.5-7B-Instruct",
      slowModel: localStorage.getItem("slow_model") || "deepseek-ai/DeepSeek-V3",
      llmBaseUrl: localStorage.getItem("llm_base_url") || "",
    };
  }
  return {
    apiBase: DEFAULT_API_BASE,
    apiKey: "",
    fastModel: "Qwen/Qwen2.5-7B-Instruct",
    slowModel: "deepseek-ai/DeepSeek-V3",
    llmBaseUrl: "",
  };
}

/** Exported so components can build streaming fetch URLs directly */
export const API_BASE = DEFAULT_API_BASE;

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

// ── Gateway Health (TrustOS Gateway on port 8787) ──────────────────────────

export interface GatewayHealth {
  status: "ok" | "degraded" | "error" | "online";
  service: string;
  mode: string;
  streaming: string;
  events_count: number;
  uptime_seconds: number;
  index: string;
  /** MWT-3B3: per-mcp runtime lifecycle snapshot */
  mcp_lifecycle?: Array<{
    name: string;
    status: "connecting" | "connected" | "disconnected" | "error";
    last_error?: string | null;
  }>;
  /** MWT-3B3: provider/model connection summary */
  providers?: Record<string, { status: string; models: string[] }>;
  gateway_overhead_ms?: number;
  timestamp?: string;
}

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8787";

// Gateway is OPTIONAL. When NEXT_PUBLIC_GATEWAY_URL is not explicitly set,
// the backend (SmartRouter) performs observation directly, so we must not
// report "Unobserved" just because the standalone gateway isn't running.
export const GATEWAY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GATEWAY_URL);

export async function fetchGatewayHealth(): Promise<GatewayHealth> {
  // Not configured → treat as online (backend self-observes). Avoids false
  // "Unobserved" on direct-to-SiliconFlow deployments.
  if (!GATEWAY_CONFIGURED) {
    return {
      status: "ok",
      service: "trustos-backend",
      mode: "direct",
      streaming: "n/a",
      uptime_seconds: 0,
      index: "n/a",
      events_count: 0,
    };
  }
  const res = await fetch(`${GATEWAY_URL}/health`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Gateway 健康检查失败 (${res.status})`);
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
    routing_success_rate: number;      // G4-1: 路由准确率
    execution_correct_rate: number;    // G4-2: 执行正确率
    value_success_rate: number;        // G4-3: 价值增益率
    user_success_rate: number;         // G4-4: 用户满意率
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
  const res = await fetch(`${apiBase}/v1/workspaces/user/mine?user_id=${encodeURIComponent(userId)}`, {
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

// ── MWT-14/19: Manager Loop (会话 → 契约 → 审批) ───────────────────────────────

export interface ManagerContract {
  contract_id: string;
  conversation_id: string;
  title: string;
  objective: string;
  intended_worker: string;
  constraints?: string[];
  status: "draft" | "ready_for_review" | "approved" | "rejected";
  created_at: string;
  updated_at: string;
}

export interface ManagerConversation {
  id: string;
  user_id: string;
  title: string;
  status: "active" | "closed" | "archived";
  created_at: string;
  updated_at: string;
}

export async function fetchManagerConversations(userId: string): Promise<{ conversations: ManagerConversation[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager-conversations`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载 Manager 会话失败 (${res.status})`);
  return res.json();
}

export async function fetchConversations(
  userId: string,
  limit = 50
): Promise<{ conversations: ManagerConversationRecord[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager-conversations?limit=${encodeURIComponent(String(limit))}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载 Manager 会话失败 (${res.status})`);
  const data = await res.json();
  const list = (data.conversations ?? []) as Array<Record<string, unknown>>;
  return {
    conversations: list.map((c) => ({ ...c, id: c.conversation_id })) as ManagerConversationRecord[],
  };
}

export async function fetchManagerContracts(conversationId: string, userId: string): Promise<{ contracts: ManagerContract[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载契约失败 (${res.status})`);
  return res.json();
}

export async function setContractStatus(
  conversationId: string,
  contractId: string,
  status: ContractStatus,
  userId: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts/${encodeURIComponent(contractId)}/status`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ status }),
    }
  );
  if (!res.ok) throw new Error(`更新契约状态失败 (${res.status})`);
}

export async function reviewContract(
  conversationId: string,
  contractId: string,
  decision: "accept_result" | "reject_result" | "request_rerun",
  userId: string,
  comment?: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({
        target_type: "execution_attempt",
        contract_id: contractId,
        decision,
        comment,
      }),
    }
  );
  if (!res.ok) throw new Error(`评审契约失败 (${res.status})`);
}

export async function triggerAttempt(conversationId: string, contractId: string, userId: string): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts/${encodeURIComponent(contractId)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ execution_mode: "deterministic_local" }),
    }
  );
  if (!res.ok) throw new Error(`触发执行失败 (${res.status})`);
}

// ── Gateway Events / Sessions (TRST-4X) ───────────────────────────────────────

export interface GatewayEvent {
  // ── Identity ──
  event_id: string;
  event_type: string;
  timestamp: string;
  trace_id?: string;
  parent_event_id?: string;
  // ── Attribution ──
  actor_id?: string;
  agent_id?: string | null;
  agent_label?: string | null;
  session_id: string;
  run_id?: string;
  project_id?: string;
  // ── Task correlation ──
  task_id?: string | null;
  // ── Source / Destination ──
  source?: string;
  destination?: string;
  resource_type?: "model" | "tool";
  resource_ref?: string;
  // ── Model-specific ──
  model?: string;
  provider?: string;
  tool_name?: string;
  // ── Frontend usage metrics ──
  input_tokens?: number;
  output_tokens?: number;
  token_count?: number;
  cost_estimate?: number | null;
  control_decision?: string;
  // ── Content Hashes ──
  input_hash?: string | null;
  output_hash?: string | null;
  args_hash?: string | null;
  result_hash?: string | null;
  // ── Metrics ──
  latency_ms?: number;
  gateway_overhead_ms?: number;
  // ── Status / Observation ──
  status?: string;
  observed?: boolean;
  user_id?: string | null;
  // ── Privacy / Classification (reserved) ──
  privacy_flags?: string[];
  data_classification?: string;
  trust_flags?: string[];
  trust_note?: string | null;
  event_hash?: string;
  /** Index signature to allow safe meta-key access and assignment to ExportEventLike */
  [key: string]: unknown;
}

export interface GatewayEventsResponse {
  events: GatewayEvent[];
  total: number;
  returned: number;
  has_more: boolean;
  next_cursor?: string | null;
  session_id?: string;
  /** TRST-4X event-stream shaped envelope */
  status?: string;
  events_count?: number;
  mode?: string;
  page?: number;
}

export interface GatewayEventsParams {
  cursor?: string;
  page?: number;
  limit?: number;
  session_id?: string;
  event_type?: string;
  agent_id?: string;
  observed?: boolean;
}

export async function fetchGatewayEvents(
  params: GatewayEventsParams = {}
): Promise<GatewayEventsResponse> {
  const { apiBase } = getApiConfig();
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.page !== undefined) query.set("page", String(params.page));
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.event_type) query.set("event_type", params.event_type);
  if (params.agent_id) query.set("agent_id", params.agent_id);
  if (params.observed !== undefined) query.set("observed", String(params.observed));
  const qs = query.toString();
  const res = await fetch(
    `${apiBase}/v1/gateway/events${qs ? `?${qs}` : ""}`,
    { headers: buildHeaders() }
  );
  if (!res.ok) throw new Error(`加载 Gateway 事件失败 (${res.status})`);
  return res.json();
}

export interface GatewaySessionItem {
  session_id: string;
  user_id: string;
  created_at: string;
  last_event_at: string;
  event_count: number;
  observed_count: number;
  distinct_agents: string[];
  /** Optional fields surfaced by OverviewView */
  agents?: string[];
  model_calls?: number;
  total_tokens?: number;
  title?: string;
  status?: string;
}

export interface GatewaySessionsResponse {
  sessions: GatewaySessionItem[];
  total: number;
}

export async function fetchGatewaySessions(userId: string, limit = 20): Promise<GatewaySessionsResponse> {
  const { apiBase } = getApiConfig();
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  const qs = query.toString();
  const res = await fetch(`${apiBase}/v1/gateway/sessions${qs ? `?${qs}` : ""}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载 Gateway 会话失败 (${res.status})`);
  return res.json();
}

// ── Gateway Report / Evidence (TRST-4X) ───────────────────────────────────────

export interface ReportControlDecisions {
  allow?: number;
  warn?: number;
  block?: number;
  unknown?: number;
}

export interface ReportTopModel {
  model: string;
  calls: number;
  tokens: number;
  cost: number;
}

export interface ReportStats {
  observed: number;
  total: number;
  failures: number;
  model_calls: number;
  tool_calls: number;
  hash_coverage_pct: number;
  failure_count?: number;
  failure_events?: number;
  total_tokens: number;
  estimated_cost: number;
  sessions?: number;
  unique_sessions?: number;
  control_decisions?: ReportControlDecisions;
  top_models?: ReportTopModel[];
  mcp_lifecycle?: Array<{ name: string; status: string }>;
  trust_flags?: string[];
}

export interface ReportSummary {
  session_id: string;
  event_count: number;
  observed_count: number;
  distinct_agents: string[];
  trust_flags: string[];
  generated_at: string;
  stats: ReportStats;
}

export type GatewayReportFormat = "html" | "md" | "download";

/**
 * Fetch the rendered Gateway Evidence Report. Returns the raw Response so the
 * caller can decide between `.text()` (html/md) and `.blob()` (download).
 */
export async function fetchGatewayReport(format: GatewayReportFormat = "html"): Promise<Response> {
  const { apiBase } = getApiConfig();
  const query = new URLSearchParams();
  query.set("format", format);
  const res = await fetch(`${apiBase}/v1/gateway/report?${query.toString()}`, {
    headers: buildHeaders(),
  });
  if (!res.ok) throw new Error(`加载 Gateway 报告失败 (${res.status})`);
  return res;
}

export async function fetchGatewayReportSummary(): Promise<ReportSummary> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/gateway/report/summary`, {
    headers: buildHeaders(),
  });
  if (!res.ok) throw new Error(`加载 Gateway 报告摘要失败 (${res.status})`);
  return res.json();
}

// ── MWT-22 / TRST-4D: Backend Assessment API (/v1/assess) ──────────────────────
// The risk/control assessment is computed server-side (api/assess.ts +
// services/assessment/assess-engine.ts). The frontend sends sanitized Gateway
// events and receives the full assessment back. Local assess-utils remains as a
// type source + offline fallback only.
//
// Response shape mirrors the backend exactly:
//   { assessments[], distribution{4-level}, control?[...], meta }

export type AssessRiskLevel = "none" | "low" | "medium" | "high";

export interface AssessSignal {
  code: string;
  severity: "low" | "medium" | "high";
  category: "privacy" | "operational" | "trace_integrity" | "behavior";
  label: string;
}

export interface AssessEntry {
  traceKey: string;
  traceLabel: string;
  eventCount: number;
  riskLevel: AssessRiskLevel;
  privacyOk: boolean;
  traceIntegrityOk: boolean;
  signals: AssessSignal[];
}

export interface AssessControlRecommendation {
  action: "allow" | "review" | "would_block";
  reasons: string[];
  mode: "dry_run";
  runtimeEffect: "none";
}

export interface AssessControlEntry {
  traceKey: string;
  traceLabel: string;
  recommendation: AssessControlRecommendation;
}

export interface AssessControlDist {
  allow: number;
  review: number;
  wouldBlock: number;
}

export interface AssessRiskDist {
  none: number;
  low: number;
  medium: number;
  high: number;
}

export interface AssessResponse {
  assessments: AssessEntry[];
  distribution: AssessRiskDist;
  control?: AssessControlEntry[];
  meta: { eventCount: number; traceCount: number; mode: string };
}

/**
 * Post Gateway events to the backend assessment engine. No writes, no
 * enforcement — the backend returns risk/control discovery derived purely from
 * the supplied (sanitized, hash-only) events. includeControl:true asks the
 * backend to also attach the dry-run control recommendations.
 */
export async function fetchAssess(events: GatewayEvent[]): Promise<AssessResponse> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/assess`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...buildHeaders() },
    body: JSON.stringify({ events, includeControl: true }),
  });
  if (!res.ok) throw new Error(`后端评估失败 (${res.status})`);
  return res.json();
}

// ── Manager Workspace (MWT-19 / Execution Attempts / Reviews) ──────────────────

export type ContractStatus = "draft" | "ready_for_review" | "approved" | "rejected" | "superseded";

export type ExecutionMode =
  | "deterministic_local"
  | "dry_run"
  | "manual_placeholder"
  | "real";

export type AttemptStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type TrustRefKind = "evidence" | "trace" | "event" | "task" | "run";

export type ReviewTargetType = "delegation_contract" | "execution_attempt";

export type ReviewDecision =
  | "approve"
  | "reject"
  | "request_changes"
  | "accept_result"
  | "reject_result"
  | "request_rerun";

export interface ManagerConversationRecord {
  conversation_id: string;
  /** Alias used by ManagerWorkspace UI (.id) */
  id: string;
  user_id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface WorkerDelegationContract {
  contract_id: string;
  conversation_id: string;
  user_id: string;
  title: string;
  objective: string;
  intended_worker: string;
  input_summary: string;
  memory_ref_ids: string[];
  trust_ref_ids: string[];
  constraints: string[];
  expected_output: string;
  status: ContractStatus;
  created_at: string;
  updated_at: string;
}

export interface WorkerExecutionAttempt {
  attempt_id: string;
  conversation_id: string;
  contract_id: string;
  user_id: string;
  worker_label: string;
  input_summary: string;
  constraints: string[];
  status: AttemptStatus;
  result_summary?: string | null;
  error_summary?: string | null;
  execution_mode: ExecutionMode;
  output_hash?: string | null;
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
}

export interface MemoryRefRecord {
  conversation_id: string;
  memory_id: string;
  user_id: string;
  created_at: string;
  preview: string;
  category: string | null;
  importance: number | null;
  source: string | null;
  tags: string[];
}

export interface TrustRefRecord {
  conversation_id: string;
  ref_kind: TrustRefKind;
  ref_id: string;
  user_id: string;
  created_at: string;
  source?: string | null;
  relevance_score?: number | null;
  related_task_id?: string | null;
}

export interface ManagerReviewRecord {
  review_id: string;
  conversation_id: string;
  user_id: string;
  target_type: ReviewTargetType;
  target_id: string;
  decision: ReviewDecision;
  reason?: string | null;
  reviewer_label?: string | null;
  created_at: string;
}

export async function fetchAttempts(
  userId: string,
  conversationId: string
): Promise<{ attempts: WorkerExecutionAttempt[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/attempts`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载执行尝试失败 (${res.status})`);
  return res.json();
}

export async function createAttempt(
  userId: string,
  conversationId: string,
  contractId: string,
  mode: ExecutionMode
): Promise<{ attempt_id: string }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts/${encodeURIComponent(contractId)}/attempts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ execution_mode: mode }),
    }
  );
  if (!res.ok) throw new Error(`创建执行尝试失败 (${res.status})`);
  return res.json();
}

export async function cancelAttempt(
  userId: string,
  conversationId: string,
  attemptId: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/attempts/${encodeURIComponent(attemptId)}/cancel`,
    {
      method: "POST",
      headers: { "X-User-Id": userId, ...buildHeaders() },
    }
  );
  if (!res.ok) throw new Error(`取消执行尝试失败 (${res.status})`);
}

export async function fetchReviews(
  userId: string,
  conversationId: string
): Promise<{ reviews: ManagerReviewRecord[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/reviews`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载评审记录失败 (${res.status})`);
  const data = await res.json();
  return { reviews: (data.reviews ?? []) as ManagerReviewRecord[] };
}

export async function createReview(
  userId: string,
  conversationId: string,
  targetType: ReviewTargetType,
  targetId: string,
  decision: ReviewDecision,
  reason?: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/reviews`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ target_type: targetType, target_id: targetId, decision, reason }),
    }
  );
  if (!res.ok) throw new Error(`创建评审记录失败 (${res.status})`);
}

// ── Manager Conversations / Messages / Routing ──────────────────────────────

export type ManagerMessageRole = "user" | "manager" | "system";

export interface ManagerMessageInput {
  conversationId: string;
  role: ManagerMessageRole;
  content: string;
}

export async function createConversation(
  userId: string,
  title?: string
): Promise<{ conversation: ManagerConversationRecord }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager-conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
    body: JSON.stringify({ title: title ?? "New Conversation" }),
  });
  if (!res.ok) throw new Error(`创建 Manager 会话失败 (${res.status})`);
  return res.json();
}

export async function fetchManagerMessages(
  userId: string,
  conversationId: string,
  limit = 100
): Promise<{ messages: import("@/types/dashboard").ManagerMessage[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/messages?limit=${encodeURIComponent(String(limit))}`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载 Manager 消息失败 (${res.status})`);
  return res.json();
}

export async function createManagerMessage(
  userId: string,
  input: ManagerMessageInput
): Promise<import("@/types/dashboard").ManagerMessage> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(input.conversationId)}/messages`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ role: input.role, content: input.content }),
    }
  );
  if (!res.ok) throw new Error(`创建 Manager 消息失败 (${res.status})`);
  return res.json();
}

export async function routeManagerMessage(
  userId: string,
  input: import("@/types/dashboard").RouteMessageRequest
): Promise<import("@/types/dashboard").RouteMessageResponse> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(input.conversationId)}/route`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ message: input.message, target_session_id: input.targetSessionId }),
    }
  );
  if (!res.ok) throw new Error(`路由 Manager 消息失败 (${res.status})`);
  return res.json();
}

// ── Memory / Trust Reference Bridges (MWT-15 / MWT-16) ────────────────────────

export async function fetchMemoryRefs(
  userId: string,
  conversationId: string
): Promise<{ memory_refs: MemoryRefRecord[]; total?: number }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/memory-refs`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载记忆引用失败 (${res.status})`);
  const data = await res.json();
  return { memory_refs: (data.memory_refs ?? []) as MemoryRefRecord[], total: data.total };
}

export async function attachMemoryRef(
  userId: string,
  conversationId: string,
  memoryId: string
): Promise<MemoryRefRecord> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/memory-refs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ memory_id: memoryId }),
    }
  );
  if (!res.ok) throw new Error(`附加记忆引用失败 (${res.status})`);
  const data = await res.json();
  return data.memory_ref as MemoryRefRecord;
}

export async function detachMemoryRef(
  userId: string,
  conversationId: string,
  memoryId: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/memory-refs/${encodeURIComponent(memoryId)}`,
    { method: "DELETE", headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`移除记忆引用失败 (${res.status})`);
}

export async function fetchTrustRefs(
  userId: string,
  conversationId: string
): Promise<{ trust_refs: TrustRefRecord[]; total?: number }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/trust-refs`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载信任引用失败 (${res.status})`);
  const data = await res.json();
  return { trust_refs: (data.trust_refs ?? []) as TrustRefRecord[], total: data.total };
}

export async function attachTrustRef(
  userId: string,
  conversationId: string,
  refKind: TrustRefKind,
  refId: string
): Promise<TrustRefRecord> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/trust-refs`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify({ ref_kind: refKind, ref_id: refId }),
    }
  );
  if (!res.ok) throw new Error(`附加信任引用失败 (${res.status})`);
  const data = await res.json();
  return data.trust_ref as TrustRefRecord;
}

export async function detachTrustRef(
  userId: string,
  conversationId: string,
  refKind: TrustRefKind,
  refId: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/trust-refs/${encodeURIComponent(refKind)}/${encodeURIComponent(refId)}`,
    { method: "DELETE", headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`移除信任引用失败 (${res.status})`);
}

// ── Worker Delegation Contracts (MWT-17) ──────────────────────────────────────

export interface ContractPatchInput {
  title?: string | null;
  objective?: string | null;
  intended_worker?: string | null;
  input_summary?: string | null;
  memory_ref_ids?: string[] | null;
  trust_ref_ids?: string[] | null;
  constraints?: string | string[] | null;
  expected_output?: string | null;
}

export async function fetchContracts(
  userId: string,
  conversationId: string
): Promise<{ contracts: WorkerDelegationContract[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载契约失败 (${res.status})`);
  const data = await res.json();
  return { contracts: (data.contracts ?? []) as WorkerDelegationContract[] };
}

export async function createContract(
  userId: string,
  conversationId: string,
  input: ContractPatchInput
): Promise<{ contract: WorkerDelegationContract }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`创建契约失败 (${res.status})`);
  const data = await res.json();
  return { contract: data.contract as WorkerDelegationContract };
}

export async function updateContract(
  userId: string,
  conversationId: string,
  contractId: string,
  patch: ContractPatchInput
): Promise<{ contract: WorkerDelegationContract }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts/${encodeURIComponent(contractId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json", "X-User-Id": userId, ...buildHeaders() },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) throw new Error(`更新契约失败 (${res.status})`);
  const data = await res.json();
  return { contract: data.contract as WorkerDelegationContract };
}

export async function deleteContract(
  userId: string,
  conversationId: string,
  contractId: string
): Promise<void> {
  const { apiBase } = getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations/${encodeURIComponent(conversationId)}/contracts/${encodeURIComponent(contractId)}`,
    { method: "DELETE", headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`删除契约失败 (${res.status})`);
}

// ── Agent Sessions (TRST-4C runtime sessions) ─────────────────────────────────

/** Alias used by OverviewView */
export type GatewaySession = GatewaySessionItem;

export async function fetchAgentSessions(
  userId: string,
  options?: { status?: string; limit?: number }
): Promise<{ sessions: import("@/types/dashboard").AgentSession[]; total?: number }> {
  const { apiBase } = getApiConfig();
  const query = new URLSearchParams();
  if (options?.status) query.set("status", options.status);
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  const qs = query.toString();
  const res = await fetch(`${apiBase}/v1/agent-sessions${qs ? `?${qs}` : ""}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载 Session 列表失败 (${res.status})`);
  const data = await res.json();
  const list = (data.sessions ?? []) as Array<Record<string, unknown>>;
  const sessions: import("@/types/dashboard").AgentSession[] = list.map((s) => ({
    id: (s.session_id as string) ?? (s.id as string) ?? "",
    session_id: (s.session_id as string) ?? (s.id as string) ?? "",
    user_id: (s.user_id as string) ?? "",
    title: (s.title as string) ?? "",
    status: ((s.status as string) ?? "unknown") as import("@/types/dashboard").SessionStatus,
    created_at: (s.created_at as string) ?? "",
    updated_at: (s.updated_at as string) ?? "",
    agents: (s.agents as string[] | undefined) ?? (s.distinct_agents as string[] | undefined),
    model_calls: s.model_calls as number | undefined,
    total_tokens: s.total_tokens as number | undefined,
    event_count: (s.event_count as number | undefined) ?? (s.events_count as number | undefined),
    observed_count: s.observed_count as number | undefined,
    distinct_agents: s.distinct_agents as string[] | undefined,
  }));
  return { sessions, total: data.total };
}

export async function fetchAgentSessionDetail(
  sessionId: string,
  userId: string
): Promise<{ session: import("@/types/dashboard").AgentSession; events: GatewayEvent[] }> {
  const { apiBase } = getApiConfig();
  const res = await fetch(`${apiBase}/v1/agent-sessions/${encodeURIComponent(sessionId)}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`加载 Session 详情失败 (${res.status})`);
  const data = await res.json();
  const s = (data.session ?? {}) as Record<string, unknown>;
  const session: import("@/types/dashboard").AgentSession = {
    id: (s.session_id as string) ?? (s.id as string) ?? sessionId,
    session_id: (s.session_id as string) ?? (s.id as string) ?? sessionId,
    user_id: (s.user_id as string) ?? "",
    title: (s.title as string) ?? "",
    status: ((s.status as string) ?? "unknown") as import("@/types/dashboard").SessionStatus,
    created_at: (s.created_at as string) ?? "",
    updated_at: (s.updated_at as string) ?? "",
    agents: (s.agents as string[] | undefined) ?? (s.distinct_agents as string[] | undefined),
    model_calls: s.model_calls as number | undefined,
    total_tokens: s.total_tokens as number | undefined,
    event_count: (s.event_count as number | undefined) ?? (s.events_count as number | undefined),
    observed_count: s.observed_count as number | undefined,
    distinct_agents: s.distinct_agents as string[] | undefined,
  };
  return { session, events: (data.events ?? []) as GatewayEvent[] };
}

export async function fetchSessionEvents(
  userId: string,
  sessionId: string,
  limit?: number
): Promise<{ events: import("@/types/dashboard").SessionEvent[] }> {
  const { apiBase } = getApiConfig();
  const query = new URLSearchParams();
  if (limit !== undefined) query.set("limit", String(limit));
  const qs = query.toString();
  const res = await fetch(
    `${apiBase}/v1/agent-sessions/${encodeURIComponent(sessionId)}/events${qs ? `?${qs}` : ""}`,
    { headers: { "X-User-Id": userId, ...buildHeaders() } }
  );
  if (!res.ok) throw new Error(`加载 Session 事件失败 (${res.status})`);
  const data = await res.json();
  const events: import("@/types/dashboard").SessionEvent[] = (data.events ?? []).map(
    (e: GatewayEvent) => ({
      id: e.event_id,
      session_id: e.session_id,
      type: (e.event_type as import("@/types/dashboard").SessionEventType) ?? "info_logged",
      summary: e.event_type,
      severity: "info" as import("@/types/dashboard").SessionEventSeverity,
      visibility: "session_timeline" as import("@/types/dashboard").SessionEventVisibility,
      raw_ref: e.event_hash ?? undefined,
      created_at: e.timestamp,
    })
  );
  return { events };
}

export async function fetchGatewayEventsByTask(
  taskId: string,
  userId = "dev-user",
  options?: { limit?: number }
): Promise<{ events: GatewayEvent[] }> {
  const { apiBase } = getApiConfig();
  const query = new URLSearchParams();
  query.set("task_id", taskId);
  if (options?.limit !== undefined) query.set("limit", String(options.limit));
  const res = await fetch(`${apiBase}/v1/gateway/events?${query.toString()}`, {
    headers: { "X-User-Id": userId, ...buildHeaders() },
  });
  if (!res.ok) throw new Error(`按任务加载事件失败 (${res.status})`);
  const data = await res.json();
  return { events: (data.events ?? []) as GatewayEvent[] };
}

export async function downloadEvidenceExport(
  taskId: string,
  artifact: import("@/lib/evidence-export").TaskEvidenceExportArtifact
): Promise<void> {
  const filename = `task-evidence-${taskId}.json`;
  const blob = new Blob([JSON.stringify(artifact, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Re-export types used by manager workspace / task evidence views
export type { ManagerMessage, RouteMessageResponse, RouteMessageRequest } from "@/types/dashboard";
