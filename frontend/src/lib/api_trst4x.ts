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
  const DEFAULT_API_BASE = "http://localhost:3001";
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

export async function fetchSessionEvents(userId: string, sessionId: string, limit = 200) {
  const { apiBase } = await getApiConfig();
  const res = await fetch(
    `${apiBase}/v1/session-events?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`,
    { headers: { "X-User-Id": userId } }
  );
  if (!res.ok) throw new Error(`加载 Session 事件失败 (${res.status})`);
  return res.json();
}

// ── TRST-2: Gateway Health ──────────────────────────────────────────────────

export interface GatewayHealth {
  status: "ok" | "degraded" | "error";
  service: string;
  mode?: string;
  streaming: string;
  mcp_lifecycle: string;
  providers: string[] | Record<string, {
    provider_id?: string;
    models?: string[];
    base_url?: string;
    model_count?: number;
  }>;
  events_count?: number;
  uptime_seconds?: number;
  gateway_overhead_ms?: number;
  timestamp?: string;
}

/** Gateway port. Can be overridden via NEXT_PUBLIC_GATEWAY_URL env var. */
const GATEWAY_URL = process.env.NEXT_PUBLIC_GATEWAY_URL || "http://localhost:8795";
const GATEWAY_CONFIGURED = Boolean(process.env.NEXT_PUBLIC_GATEWAY_URL);

export async function fetchGatewayHealth(): Promise<GatewayHealth> {
  if (!GATEWAY_CONFIGURED) {
    return {
      status: "offline",
      configured: false,
      service: "gateway",
      streaming: false,
      mcp_lifecycle: false,
      providers: {},
    } as unknown as GatewayHealth;
  }
  const res = await fetch(`${GATEWAY_URL}/health`);
  if (!res.ok) throw new Error(`网关健康检查失败 (${res.status})`);
  return res.json();
}

// ── TRST-2E: Event Chain Viewer ──────────────────────────────────────────────

export interface GatewayEvent {
  event_id?: string | null;
  event_type?: string | null;
  timestamp?: string | null;
  status?: string | null;
  trace_id?: string | null;
  session_id?: string | null;
  run_id?: string | null;
  source?: string | null;
  destination?: string | null;
  resource_type?: string | null;
  resource_ref?: string | null;
  provider?: string | null;
  model?: string | null;
  tool_name?: string | null;
  tool_id?: string | null;
  event_hash?: string | null;
  input_hash?: string | null;
  output_hash?: string | null;
  args_hash?: string | null;
  result_hash?: string | null;
  latency_ms?: number | null;
  gateway_overhead_ms?: number | null;
  privacy_flags?: string[] | null;
  token_count?: number | null;
  cost_estimate?: number | null;
  actor_id?: string | null;
  agent_id?: string | null;
  project_id?: string | null;
}

export interface GatewayEventsResponse {
  status: string;
  service: string;
  mode: string;
  page?: number;
  limit: number;
  total?: number;
  has_more?: boolean;
  events_count: number;
  returned_count: number;
  events: GatewayEvent[];
}

export interface GatewayEventsParams {
  limit?: number;
  page?: number;
  session_id?: string;
  event_type?: string;
  agent_id?: string;
}

export async function fetchGatewayEvents(params: GatewayEventsParams = {}): Promise<GatewayEventsResponse> {
  const sp = new URLSearchParams();
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.page) sp.set("page", String(params.page));
  if (params.session_id) sp.set("session_id", params.session_id);
  if (params.event_type) sp.set("event_type", params.event_type);
  if (params.agent_id) sp.set("agent_id", params.agent_id);
  const qs = sp.toString();
  const url = qs ? `${GATEWAY_URL}/events?${qs}` : `${GATEWAY_URL}/events`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`网关事件查询失败 (${res.status})`);
  return res.json();
}

export interface GatewaySessionItem {
  session_id: string;
  first_event: string;
  last_event: string;
  event_count: number;
  model_calls: number;
  tool_calls: number;
  total_tokens: number;
  agents: string[];
}

export interface GatewaySessionsResponse {
  status: string;
  service: string;
  mode: string;
  returned_count: number;
  sessions: GatewaySessionItem[];
}

export async function fetchGatewaySessions(limit = 20): Promise<GatewaySessionsResponse> {
  const res = await fetch(`${GATEWAY_URL}/sessions?limit=${limit}`);
  if (!res.ok) throw new Error(`会话查询失败 (${res.status})`);
  return res.json();
}
