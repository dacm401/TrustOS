import { DelegationLogRepo, GrowthRepo } from "../db/repositories.js";
import type { DashboardData } from "../types/index.js";

export async function calculateDashboard(userId: string): Promise<DashboardData> {
  const [recentLogs, growth] = await Promise.all([
    DelegationLogRepo.listByUser(userId, 20, 0),
    GrowthRepo.getProfile(userId),
  ]);

  // today's rows
  const todayRows = recentLogs.filter(
    (r) => new Date(r.created_at).toDateString() === new Date().toDateString()
  );
  const total_requests = todayRows.length;
  const fast_count = todayRows.filter(
    (r) => r.routed_action === "direct_answer"
  ).length;
  const slow_count = todayRows.filter(
    (r) => r.routed_action === "delegate_to_slow" || r.routed_action === "execute_task"
  ).length;
  const fallback_count = todayRows.filter(
    (r) => r.execution_status && r.execution_status !== "success"
  ).length;
  // delegation_logs stores cost_usd and latency_ms directly
  const total_cost = todayRows.reduce((s, r) => s + (r.cost_usd || 0), 0);
  const avg_latency =
    todayRows.length > 0
      ? Math.round(todayRows.reduce((s, r) => s + (r.latency_ms || 0), 0) / todayRows.length)
      : 0;
  // saved_cost not captured in delegation_logs; report 0 until Phase 5 cost tracking
  const saved_cost = 0;
  const savingRate = total_cost > 0 ? Math.round((saved_cost / (total_cost + saved_cost)) * 100) : 0;
  // satisfaction proxy: ratio of user_success=true among rows with user_success set
  const withFeedback = todayRows.filter((r) => r.user_success !== null && r.user_success !== undefined);
  const satisfied = withFeedback.filter((r) => r.user_success === true).length;
  const satisfaction_proxy = withFeedback.length > 0 ? Math.round((satisfied / withFeedback.length) * 100) : 0;

  // token flow — delegation_logs doesn't capture tokens; report 0 (Phase 5 storage)
  const tokenFlow = { fast_tokens: 0, slow_tokens: 0, compressed_tokens: 0, fallback_tokens: 0 };

  const todayStats = {
    total_requests,
    fast_count,
    slow_count,
    fallback_count,
    total_tokens: 0,
    total_cost,
    saved_cost,
    avg_latency,
    satisfaction_rate: satisfaction_proxy,
  };

  return {
    today: {
      total_requests: todayStats.total_requests,
      fast_count: todayStats.fast_count,
      slow_count: todayStats.slow_count,
      fallback_count: todayStats.fallback_count,
      total_tokens: todayStats.total_tokens,
      total_cost: Math.round(todayStats.total_cost * 10000) / 10000,
      saved_cost: Math.round(todayStats.saved_cost * 10000) / 10000,
      saving_rate: savingRate,
      avg_latency_ms: todayStats.avg_latency,
      satisfaction_proxy: todayStats.satisfaction_rate,
    },
    token_flow: tokenFlow,
    recent_decisions: recentLogs.map(mapDelegationToDecisionRow),
    growth,
  };
}

/**
 * Map a DelegationLog row (delegation_logs table) to the format expected by the dashboard.
 * delegation_logs is the canonical table for all routing decisions post-G4 migration.
 */
function mapDelegationToDecisionRow(row: any): any {
  // Map routed_action → selected_role semantics
  const selected_role =
    row.routed_action === "direct_answer" ? "fast" : "slow";
  const selected_model = row.model_used || null;

  // Map llm_scores (JSON) → fast/slow scores for dashboard display
  let fast_score = 0;
  let slow_score = 0;
  if (row.llm_scores) {
    const scores = typeof row.llm_scores === "string" ? JSON.parse(row.llm_scores) : row.llm_scores;
    fast_score = scores.direct_answer ?? 0;
    slow_score = Math.max(scores.delegate_to_slow ?? 0, scores.execute_task ?? 0);
  }

  return {
    id: row.id,
    timestamp: new Date(row.created_at).getTime(),
    input_features: {
      raw_query: row.raw_query || null,
      intent: row.routed_action,
      complexity_score: null,
      token_count: null,
      has_code: null,
      has_math: null,
    },
    routing: {
      router_version: row.routing_version || "v2",
      scores: { fast: fast_score, slow: slow_score },
      confidence: row.llm_confidence ?? row.system_confidence ?? null,
      selected_model,
      selected_role,
      selection_reason: row.routing_reason || null,
    },
    context: {
      original_tokens: null,
      compressed_tokens: null,
      compression_level: null,
      compression_ratio: null,
    },
    execution: {
      model_used: selected_model,
      input_tokens: null,
      output_tokens: null,
      total_cost_usd: row.cost_usd ?? 0,
      latency_ms: row.latency_ms ?? null,
      did_fallback: row.execution_status !== null && row.execution_status !== "success",
    },
    feedback: row.user_success !== null && row.user_success !== undefined
      ? { type: "implicit", score: row.user_success ? 1 : 0 }
      : undefined,
  };
}
