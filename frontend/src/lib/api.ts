import { getSecureApiKey } from "./crypto-utils";

// 模块级缓存：解密后的 API Key（避免每次请求都解密）
let _cachedApiKey: string | null | undefined = undefined; // undefined = 未加载，null = 未存储

async function getCachedApiKey(): Promise<string> {
  if (_cachedApiKey !== undefined) return _cachedApiKey ?? "";
  _cachedApiKey = (await getSecureApiKey()) ?? "";
  return _cachedApiKey;
}

/** 同步获取 API 配置（API Key 取自缓存，首次调用触发懒解密） */
export async function getApiConfig() {
  const DEFAULT_API_BASE = "http://localhost:3002";
  if (typeof window !== "undefined") {
    return {
      apiBase: DEFAULT_API_BASE,
      llmBaseUrl: localStorage.getItem("llm_base_url") || "",
      apiKey: await getCachedApiKey(),
      fastModel: localStorage.getItem("fast_model") || "",
      slowModel: localStorage.getItem("slow_model") || "",
    };
  }
  return {
    apiBase: process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_BASE,
    llmBaseUrl: "",
    apiKey: "",
    fastModel: "",
    slowModel: "",
  };
}

/** Exported so components can build streaming fetch URLs directly */
export const API_BASE = "http://localhost:3001";

export async function sendMessage(message: string, history: Array<{ role: string; content: string }>, userId: string, sessionId: string) {
  const { apiBase, llmBaseUrl, apiKey, fastModel, slowModel } = await getApiConfig();
  const body: Record<string, string | number | boolean | object> = { user_id: userId, session_id: sessionId, message, history };
  // 如果前端设置里有 Key / 模型 / LLM地址，透传给后端覆盖环境变量
  if (llmBaseUrl) body.llm_base_url = llmBaseUrl;
  if (apiKey) body.api_key = apiKey;
  if (fastModel) body.fast_model = fastModel;
  if (slowModel) body.slow_model = slowModel;

  const res = await fetch(`${apiBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || `服务器错误 (${res.status})`);
  }
  return data;
}

export async function sendFeedback(decisionId: string, type: string, userId: string, reason?: string) {
  const { apiBase } = await getApiConfig();
  const body: Record<string, string> = { decision_id: decisionId, feedback_type: type, user_id: userId };
  if (reason) body.reason = reason;
  await fetch(`${apiBase}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// UI1: Workbench panels API helpers
// NOTE: tasks and evidence live under /v1/* (backend index.ts app.route("/v1/tasks/...", taskRouter))

export async function fetchTasks(userId: string, sessionId?: string) {
  const { apiBase } = await getApiConfig();
  const url = sessionId
    ? `${apiBase}/v1/tasks/all?session_id=${encodeURIComponent(sessionId)}`
    : `${apiBase}/v1/tasks/all`;
  const res = await fetch(url, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务列表失败 (${res.status})`);
  return res.json();
}

export async function fetchTaskDetail(taskId: string, userId: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务详情失败 (${res.status})`);
  return res.json();
}

export async function fetchTaskSummary(taskId: string, userId: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/summary`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务摘要失败 (${res.status})`);
  return res.json();
}

export async function fetchEvidence(taskId: string, userId: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/evidence?task_id=${encodeURIComponent(taskId)}`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载证据列表失败 (${res.status})`);
  return res.json();
}

export async function fetchTraces(taskId: string, userId: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/traces`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载执行轨迹失败 (${res.status})`);
  return res.json();
}

// MWT-4B — download a task's evidence export as a JSON file.
export function downloadEvidenceExport(taskId: string, artifact: unknown): void {
  const blob = new Blob([JSON.stringify(artifact, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `evidence-export-${taskId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/health`);
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
  const { apiBase } = await getApiConfig();
  const url = category
    ? `${apiBase}/v1/memory?category=${encodeURIComponent(category)}`
    : `${apiBase}/v1/memory`;
  const res = await fetch(url, { headers: { "X-User-Id": userId } });
  if (!res.ok) throw new Error(`加载记忆列表失败 (${res.status})`);
  return res.json() as Promise<{ entries: MemoryEntry[] }>;
}

export async function deleteMemory(id: string, userId: string): Promise<void> {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/memory/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`删除记忆失败 (${res.status})`);
}

export async function createMemoryEntry(
  userId: string,
  category: string,
  content: string,
  source: string = "manual"
): Promise<MemoryEntry> {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
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
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/decision`, {
    headers: { "X-User-Id": userId },
  });
  if (res.status === 404) return null; // 没有决策数据是正常情况
  if (!res.ok) throw new Error(`加载决策数据失败 (${res.status})`);
  return res.json();
}

export async function patchTask(taskId: string, userId: string, action: "resume" | "pause" | "cancel"): Promise<boolean> {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
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
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/api/cost-stats/${encodeURIComponent(userId)}`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载成本统计失败 (${res.status})`);
  return res.json() as Promise<CostStats>;
}

// Performance time-series charts (latency / QPS / tokens)
export interface PerformanceData {
  latency: Array<{ timestamp: string; p50: number; p95: number; p99: number }>;
  qps: Array<{ timestamp: string; qps: number; errors: number }>;
  tokens: Array<{ timestamp: string; inputTokens: number; outputTokens: number }>;
}

export async function fetchPerformance(userId: string, range: string = "7d"): Promise<PerformanceData> {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/api/performance/${encodeURIComponent(userId)}?range=${range}`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载性能数据失败 (${res.status})`);
  return res.json() as Promise<PerformanceData>;
}

// ── S94P: Observability API ─────────────────────────────────────────────────

export interface ObservabilitySummary {
  summary: {
    total_requests_24h: number;
    success_count_24h: number;
    failure_count_24h: number;
    cancelled_count_24h: number;
    success_rate_pct: number;
    avg_duration_sec: number;
    p95_duration_sec: number;
  };
  cost: {
    today_cost_usd: number;
    today_input_tokens: number;
    today_output_tokens: number;
  };
  sessions: {
    active_24h: number;
  };
  health: {
    database: string;
    llm_api: string;
    overall: string;
  };
}

export async function fetchObservability(userId: string): Promise<ObservabilitySummary> {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/observability/summary`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载可观测性数据失败 (${res.status})`);
  return res.json() as Promise<ObservabilitySummary>;
}

// S94P: Paginated task list
export async function fetchTasksRecent(
  userId: string,
  options?: { limit?: number; offset?: number; status?: string }
) {
  const { apiBase } = await getApiConfig();
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));
  if (options?.status) params.set("status", options.status);

  const res = await fetch(`${apiBase}/v1/tasks/recent?${params.toString()}`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务列表失败 (${res.status})`);
  return res.json();
}

// S94P: Get task result
export async function fetchTaskResult(taskId: string, userId: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/tasks/${encodeURIComponent(taskId)}/result`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载任务结果失败 (${res.status})`);
  return res.json();
}

// ── S100P: Manager Workspace APIs ─────────────────────────────────────────────

export async function fetchAgentSessions(userId: string, options?: { status?: string; limit?: number }) {
  const { apiBase } = await getApiConfig();
  const params = new URLSearchParams();
  if (options?.status) params.set("status", options.status);
  if (options?.limit) params.set("limit", String(options.limit));
  const qs = params.toString();
  const url = `${apiBase}/v1/agent-sessions${qs ? `?${qs}` : ""}`;
  const res = await fetch(url, { headers: { "X-User-Id": userId } });
  if (!res.ok) throw new Error(`加载 Session 列表失败 (${res.status})`);
  return res.json();
}

export async function fetchAgentSessionDetail(sessionId: string, userId: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/agent-sessions/${encodeURIComponent(sessionId)}`, {
    headers: { "X-User-Id": userId },
  });
  if (!res.ok) throw new Error(`加载 Session 详情失败 (${res.status})`);
  return res.json();
}

export async function routeManagerMessage(
  userId: string,
  body: { conversationId: string; message: string; targetSessionId?: string }
) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager/route-message`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `路由消息失败 (${res.status})`);
  }
  return res.json();
}

export async function fetchManagerMessages(userId: string, conversationId: string, limit = 100) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-messages?conversationId=${encodeURIComponent(conversationId)}&limit=${limit}`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载对话消息失败 (${res.status})`);
  return res.json();
}

export async function createManagerMessage(
  userId: string,
  body: { conversationId: string; role: string; content: string; relatedSessionId?: string }
) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager-messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`创建消息失败 (${res.status})`);
  return res.json();
}

// MWT-14: ManagerConversation list + create
export interface ManagerConversationRecord {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchConversations(userId: string, limit = 50) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/manager-conversations?limit=${limit}`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载会话列表失败 (${res.status})`);
  return res.json() as Promise<{ conversations: ManagerConversationRecord[]; total: number }>;
}

export async function createConversation(userId: string, title?: string) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(`${apiBase}/v1/manager-conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": userId },
    body: JSON.stringify(title ? { title } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `创建会话失败 (${res.status})`);
  }
  return res.json() as Promise<{ conversation: ManagerConversationRecord }>;
}

export async function fetchSessionEvents(userId: string, sessionId: string, limit = 200) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/session-events?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载 Session 事件失败 (${res.status})`);
  return res.json();
}

/* ── Gateway Health ─────────────────────────────────────────────────────────── */

const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:3000";

export interface GatewayHealth {
  status: "online" | "offline" | "degraded" | "unknown";
  uptime_seconds?: number;
  request_count?: number;
  error_count?: number;
  last_check?: string;
  // Backend /health may also return operational detail (optional, not required).
  service?: string;
  mode?: "shadow" | "enforce" | string;
  timestamp?: string;
  gateway_overhead_ms?: number;
  events_count?: number;
  index?: string;
  providers?: unknown;
  streaming?: string | { supported?: boolean; error?: string | null } | null;
  mcp_lifecycle?: string | { supported?: boolean; error?: string | null } | null;
}

export async function fetchGatewayHealth(): Promise<GatewayHealth> {
  try {
    const res = await fetch(`${GATEWAY_URL}/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return { status: "offline" };
  }
}

/* ── Gateway Events ────────────────────────────────────────────────────────── */

export interface GatewayEvent {
  event_id: string;
  event_type: string;
  timestamp: string;
  status?: string;
  agent_id?: string;
  model?: string;
  [key: string]: unknown;
}

export interface GatewayEventsResponse {
  events: GatewayEvent[];
  total: number;
  // Optional backend metadata (not all responses include these).
  status?: string;
  service?: string;
  mode?: string;
  returned_count?: number;
  has_more?: boolean;
  page?: number;
  limit?: number;
  events_count?: number;
}

export async function fetchGatewayEvents(
  params: GatewayEventsParams = {}
): Promise<GatewayEventsResponse> {
  const { limit = 50, page = 1, session_id, event_type, agent_id, task_id, unassigned } = params;
  const qs = new URLSearchParams();
  qs.set("limit", String(limit));
  qs.set("page", String(page));
  if (session_id) qs.set("session_id", session_id);
  if (event_type) qs.set("event_type", event_type);
  if (agent_id) qs.set("agent_id", agent_id);
  if (task_id != null) qs.set("task_id", task_id);
  if (unassigned) qs.set("unassigned", "true");
  try {
    const res = await fetch(`${GATEWAY_URL}/events?${qs.toString()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return { events: [], total: 0 };
  }
}

// MWT-4A: task-correlated event projection (frontend-only; reuses MWT-3B1 endpoint).
export async function fetchGatewayEventsByTask(
  taskId: string,
  limit = 200
): Promise<GatewayEventsResponse> {
  if (!taskId) return { events: [], total: 0 };
  try {
    const res = await fetch(`${GATEWAY_URL}/events?task_id=${encodeURIComponent(taskId)}&limit=${limit}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return { events: [], total: 0 };
  }
}

// Query params accepted by the Gateway events endpoint (optional, frontend-only typing).
export interface GatewayEventsParams {
  limit?: number;
  page?: number;
  session_id?: string;
  event_type?: string;
  agent_id?: string;
  task_id?: string | null;
  unassigned?: boolean;
}

// ── Gateway Sessions ─────────────────────────────────────────────────────────

export interface GatewaySession {
  session_id: string;
  user_id?: string;
  started_at?: string;
  last_active_at?: string;
  status?: string;
  task_count?: number;
  request_count?: number;
  agents?: string[];
  event_count?: number;
  model_calls?: number;
  total_tokens?: number;
}

export interface GatewaySessionsResponse {
  status?: string;
  service?: string;
  mode?: string;
  limit?: number;
  returned_count?: number;
  sessions: GatewaySession[];
}

export async function fetchGatewaySessions(limit = 50): Promise<GatewaySessionsResponse> {
  try {
    const res = await fetch(`${GATEWAY_URL}/sessions?limit=${limit}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return { sessions: [] };
  }
}

/* ── Evidence Report ───────────────────────────────────────────────────────── */

export interface ReportSummary {
  stats: {
    model_calls: number;
    tool_calls: number;
    hash_coverage_pct: number;
    failure_events: number;
    failure_count?: number;
    unique_sessions?: number;
    total_tokens: number;
    estimated_cost: number | null;
    sessions: number;
    control_decisions: {
      allow: number;
      warn: number;
      block: number;
      unknown: number;
    };
    top_models: Array<{
      model: string;
      calls: number;
      tokens: number;
      cost: number | null;
    }>;
  };
  event_count: number;
  generated_at: string | null;
}

export async function fetchGatewayReportSummary(): Promise<ReportSummary> {
  try {
    const res = await fetch(`${GATEWAY_URL}/report/summary`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return {
      stats: {
        model_calls: 0,
        tool_calls: 0,
        hash_coverage_pct: 0,
        failure_events: 0,
        total_tokens: 0,
        estimated_cost: null,
        sessions: 0,
        control_decisions: { allow: 0, warn: 0, block: 0, unknown: 0 },
        top_models: [],
      },
      event_count: 0,
      generated_at: null,
    };
  }
}

export async function fetchGatewayReport(format: "html" | "download" | "md" = "html"): Promise<Response> {
  const qs = format === "download" ? "" : `?format=${format}`;
  const res = await fetch(`${GATEWAY_URL}/report${qs}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}
