import promClient, {
  Counter,
  Histogram,
  Gauge,
  Registry,
} from 'prom-client';

// Create a custom register to avoid conflicts
const register = new Registry();

// HTTP 请求指标
export const httpRequestsTotal = new Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'path', 'status_code'] as const,
  registers: [register],
});

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'path'] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

// LLM 调用指标
export const llmCallsTotal = new Counter({
  name: 'llm_calls_total',
  help: 'Total number of LLM calls',
  labelNames: ['model', 'role', 'provider', 'status'] as const,
  registers: [register],
});

export const llmCallDuration = new Histogram({
  name: 'llm_call_duration_seconds',
  help: 'LLM call duration in seconds',
  labelNames: ['model', 'role'] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [register],
});

export const llmTokensTotal = new Counter({
  name: 'llm_tokens_total',
  help: 'Total number of tokens consumed',
  labelNames: ['model', 'type'] as const, // type: input, output
  registers: [register],
});

export const llmCallFailures = new Counter({
  name: 'llm_call_failures_total',
  help: 'Total number of LLM call failures',
  labelNames: ['model', 'error_type'] as const,
  registers: [register],
});

// 路由决策指标
export const routingDecisionsTotal = new Counter({
  name: 'routing_decisions_total',
  help: 'Total number of routing decisions',
  labelNames: ['intent', 'complexity', 'selected_model', 'layer'] as const,
  registers: [register],
});

export const routingAccuracy = new Gauge({
  name: 'routing_accuracy_ratio',
  help: 'Routing accuracy ratio',
  labelNames: ['layer'] as const,
  registers: [register],
});

// 缓存指标
export const cacheOperationsTotal = new Counter({
  name: 'cache_operations_total',
  help: 'Total number of cache operations',
  labelNames: ['operation', 'status'] as const,
  registers: [register],
});

export const cacheHitRatio = new Gauge({
  name: 'cache_hit_ratio',
  help: 'Cache hit ratio (0-1)',
  labelNames: ['cache_type'] as const,
  registers: [register],
});

export const cacheLatency = new Histogram({
  name: 'cache_operation_duration_seconds',
  help: 'Cache operation duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1],
  registers: [register],
});

// 数据库指标
export const databaseQueriesTotal = new Counter({
  name: 'database_queries_total',
  help: 'Total number of database queries',
  labelNames: ['table', 'operation'] as const,
  registers: [register],
});

export const databaseQueryDuration = new Histogram({
  name: 'database_query_duration_seconds',
  help: 'Database query duration in seconds',
  labelNames: ['operation'] as const,
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [register],
});

export const databaseConnections = new Gauge({
  name: 'database_connections_active',
  help: 'Number of active database connections',
  registers: [register],
});

// 任务指标
export const tasksTotal = new Counter({
  name: 'tasks_total',
  help: 'Total number of tasks created',
  labelNames: ['mode', 'status'] as const,
  registers: [register],
});

export const tasksActive = new Gauge({
  name: 'tasks_active_count',
  help: 'Number of currently active tasks',
  labelNames: ['mode'] as const,
  registers: [register],
});

export const taskDuration = new Histogram({
  name: 'task_duration_seconds',
  help: 'Task completion duration in seconds',
  labelNames: ['mode', 'status'] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600],
  registers: [register],
});

// 熔断器指标
export const circuitBreakerState = new Gauge({
  name: 'circuit_breaker_state',
  help: 'Circuit breaker state (0=closed, 1=open, 2=half-open)',
  labelNames: ['service'] as const,
  registers: [register],
});

export const circuitBreakerTripsTotal = new Counter({
  name: 'circuit_breaker_trips_total',
  help: 'Total number of circuit breaker trips',
  labelNames: ['service'] as const,
  registers: [register],
});

// 内存指标
export const processMemoryUsed = new Gauge({
  name: 'process_memory_used_bytes',
  help: 'Process memory usage in bytes',
  registers: [register],
});

export const processHeapUsed = new Gauge({
  name: 'process_heap_used_bytes',
  help: 'Process heap usage in bytes',
  registers: [register],
});

// 系统信息
export const appInfo = new Gauge({
  name: 'app_info',
  help: 'Application information',
  labelNames: ['version', 'env', 'node_version'] as const,
  registers: [register],
});

// SSE 流指标
export const sseStreamsActive = new Gauge({
  name: 'sse_streams_active_count',
  help: 'Number of active SSE streams',
  registers: [register],
});

export const sseEventsTotal = new Counter({
  name: 'sse_events_total',
  help: 'Total number of SSE events sent',
  labelNames: ['event_type'] as const,
  registers: [register],
});

// 成本追踪
export const costTotalUsd = new Gauge({
  name: 'cost_total_usd',
  help: 'Total cost in USD',
  labelNames: ['period'] as const,
  registers: [register],
});

export const costSavedUsd = new Gauge({
  name: 'cost_saved_usd',
  help: 'Total saved cost in USD vs baseline',
  labelNames: ['period'] as const,
  registers: [register],
});

// 设置默认指标采集
promClient.collectDefaultMetrics({
  register,
  prefix: 'nodejs_',
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
});

// 导出统一的 register
export { register };

// Helper functions for collecting metrics
export function updateMemoryMetrics() {
  const usage = process.memoryUsage();
  processMemoryUsed.set(usage.rss);
  processHeapUsed.set(usage.heapUsed);
}

export function updateCircuitBreakerMetrics(
  service: string,
  state: 'closed' | 'open' | 'half-open',
  tripped: boolean
) {
  const stateValue = state === 'closed' ? 0 : state === 'open' ? 1 : 2;
  circuitBreakerState.set({ service }, stateValue);
  if (tripped) {
    circuitBreakerTripsTotal.inc({ service });
  }
}

export function recordDatabaseOperation(
  operation: string,
  durationMs: number,
  table?: string
) {
  databaseQueriesTotal.inc({ operation, table: table || 'unknown' });
  databaseQueryDuration.observe({ operation }, durationMs / 1000);
}

export function recordCacheOperation(
  operation: string,
  durationMs: number,
  hit: boolean
) {
  cacheOperationsTotal.inc({
    operation,
    status: hit ? 'hit' : 'miss',
  });
  cacheLatency.observe({ operation }, durationMs / 1000);
}
