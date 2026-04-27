"use client";
import { useEffect, useState, useCallback } from "react";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import {
  fetchDelegationLogs,
  fetchDelegationStats,
  type DelegationLog,
  type DelegationStats,
} from "@/lib/api";

const USER_ID = "user-001";
const PAGE_SIZE = 20;

const ACTION_LABELS: Record<string, string> = {
  direct_answer: "⚡ 直接回答",
  delegate_to_slow: "🧠 委托慢模型",
  ask_clarification: "❓ 需求澄清",
  execute_task: "✅ 执行任务",
};

const ACTION_COLORS: Record<string, string> = {
  direct_answer: "text-green-600 bg-green-50",
  delegate_to_slow: "text-purple-600 bg-purple-50",
  ask_clarification: "text-amber-600 bg-amber-50",
  execute_task: "text-blue-600 bg-blue-50",
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending: { label: "⏳ 待执行", color: "text-gray-500 bg-gray-50" },
  running: { label: "🔄 执行中", color: "text-blue-500 bg-blue-50" },
  success: { label: "✅ 成功", color: "text-green-600 bg-green-50" },
  failed: { label: "❌ 失败", color: "text-red-500 bg-red-50" },
  skipped: { label: "⏭️ 跳过", color: "text-gray-400 bg-gray-100" },
};

function SuccessRateBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number | null;
  color: string;
}) {
  const pct = value !== null ? Math.round(value * 100) : null;
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-gray-500 w-20 flex-shrink-0">{label}</span>
      {pct === null ? (
        <span className="text-xs text-gray-400 italic">暂无数据</span>
      ) : (
        <>
          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${color}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-xs font-mono font-bold text-gray-700 w-10 text-right">
            {pct}%
          </span>
        </>
      )}
    </div>
  );
}

function StatChip({
  icon,
  label,
  value,
  sub,
  bg,
  color,
}: {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  bg: string;
  color: string;
}) {
  return (
    <div className={`rounded-xl p-3 border-0 ${bg}`}>
      <div className="text-xl mb-1">{icon}</div>
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-xs text-gray-500 font-medium">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  );
}

export function DelegationLogsPanel() {
  const [logs, setLogs] = useState<DelegationLog[]>([]);
  const [stats, setStats] = useState<DelegationStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [polling, setPolling] = useState(false);

  const fetchAll = useCallback(async () => {
    setPolling(true);
    try {
      const [logsData, statsData] = await Promise.all([
        fetchDelegationLogs(USER_ID, PAGE_SIZE, 0),
        fetchDelegationStats(USER_ID),
      ]);
      setLogs(logsData.logs ?? []);
      setStats(statsData ?? null);
      setTotal(logsData.limit + (logsData.offset ?? 0));
    } catch (e: any) {
      setError(e.message ?? "加载失败");
    } finally {
      setPolling(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    // 非 terminal 任务轮询：每 5s 刷新一次
    const interval = setInterval(fetchAll, 5000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const hasLogs = logs.length > 0;
  const metrics = stats?.metrics;
  const rerankStats = stats?.rerankStats;

  // 四层成功率（从 logs 实时计算，不用 metrics 兜底）
  const routingSuccessRate =
    logs.filter((l) => l.routing_success === true).length / Math.max(logs.filter((l) => l.routing_success !== null).length, 1);
  const executionSuccessRate =
    logs.filter((l) => l.execution_status === "success").length / Math.max(logs.filter((l) => l.execution_status !== null).length, 1);
  const valueSuccessRate =
    logs.filter((l) => l.value_success === true).length / Math.max(logs.filter((l) => l.value_success !== null).length, 1);
  const userSuccessRate =
    logs.filter((l) => l.user_success === true).length / Math.max(logs.filter((l) => l.user_success !== null).length, 1);

  return (
    <div className="space-y-4">
      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {/* 四层成功率 */}
        <Card className="col-span-2 lg:col-span-1">
          <div className="text-xs font-semibold text-gray-500 mb-2">🎯 路由准确率</div>
          <SuccessRateBar
            label=""
            value={metrics?.routing_success_rate ?? routingSuccessRate}
            color="bg-blue-500"
          />
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <div className="text-xs font-semibold text-gray-500 mb-2">⚙️ 执行正确率</div>
          <SuccessRateBar
            label=""
            value={metrics?.execution_correct_rate ?? executionSuccessRate}
            color="bg-green-500"
          />
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <div className="text-xs font-semibold text-gray-500 mb-2">💎 价值增益率</div>
          <SuccessRateBar
            label=""
            value={metrics?.value_success_rate ?? valueSuccessRate}
            color="bg-purple-500"
          />
        </Card>
        <Card className="col-span-2 lg:col-span-1">
          <div className="text-xs font-semibold text-gray-500 mb-2">👤 用户满意率</div>
          <SuccessRateBar
            label=""
            value={metrics?.user_success_rate ?? userSuccessRate}
            color="bg-amber-500"
          />
        </Card>
        {/* 其他指标 */}
        <StatChip
          icon="📋"
          label="总决策数"
          value={metrics?.total_decisions?.toLocaleString() ?? "—"}
          sub={`本页 ${logs.length} 条`}
          bg="bg-gray-50"
          color="text-gray-700"
        />
        <StatChip
          icon="🔄"
          label="重排触发"
          value={rerankStats ? `${Math.round(rerankStats.rerank_rate * 100)}%` : "—"}
          sub={rerankStats ? `修正率 ${Math.round(rerankStats.correction_rate * 100)}%` : undefined}
          bg="bg-orange-50"
          color="text-orange-600"
        />
      </div>

      {/* Action Distribution */}
      {metrics?.action_distribution && Object.keys(metrics.action_distribution).length > 0 && (
        <Card>
          <div className="text-xs font-semibold text-gray-500 mb-3">📊 动作分布</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.action_distribution).map(([action, count]) => {
              const total = Object.values(metrics.action_distribution).reduce((a, b) => a + b, 0);
              const pct = Math.round(((count as number) / total) * 100);
              return (
                <Badge key={action} variant="default">
                  {ACTION_LABELS[action] ?? action}{" "}
                  <span className="ml-1 font-mono font-bold">{pct}%</span>
                  <span className="ml-1 text-gray-400">({count as number})</span>
                </Badge>
              );
            })}
          </div>
        </Card>
      )}

      {/* Logs Table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-gray-700">📋 委托决策日志</h3>
          <div className="flex items-center gap-2">
            {polling && (
              <span className="text-xs text-gray-400 animate-pulse">● 实时</span>
            )}
            <button
              onClick={fetchAll}
              disabled={polling}
              className="text-xs bg-gray-100 hover:bg-gray-200 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              🔄 刷新
            </button>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-3 border-blue-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : error ? (
          <div className="text-center text-red-400 py-8 text-sm">{error}</div>
        ) : !hasLogs ? (
          <div className="text-center text-gray-400 py-12 text-sm">
            暂无委托日志 · 生产流量积累后自动展示
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">时间</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">G1 动作</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">G2 / G3</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">执行</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">路由</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">执行</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">价值</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">用户</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">置信度</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">延迟</th>
                  <th className="text-left py-2 pr-3 text-gray-400 font-medium">费用</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const g2Changed = log.g2_final_action && log.g2_final_action !== log.routed_action;
                  const g3Changed = log.g3_final_action && log.g3_final_action !== (log.g2_final_action ?? log.routed_action);
                  const statusInfo = STATUS_LABELS[log.execution_status ?? ""] ?? {
                    label: "—",
                    color: "text-gray-400 bg-gray-50",
                  };
                  return (
                    <tr
                      key={log.id}
                      className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors"
                    >
                      <td className="py-2 pr-3 text-gray-400 whitespace-nowrap">
                        {new Date(log.created_at).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </td>
                      {/* G1 动作 */}
                      <td className="py-2 pr-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                            ACTION_COLORS[log.routed_action] ?? "text-gray-600 bg-gray-50"
                          }`}
                        >
                          {ACTION_LABELS[log.routed_action] ?? log.routed_action}
                        </span>
                      </td>
                      {/* G2 / G3 */}
                      <td className="py-2 pr-3 space-y-0.5">
                        {log.did_rerank ? (
                          <>
                            {g2Changed && (
                              <div className="text-amber-600 text-xs">
                                G2: {ACTION_LABELS[log.g2_final_action!] ?? log.g2_final_action}
                              </div>
                            )}
                            {g3Changed && (
                              <div className="text-orange-600 text-xs">
                                G3: {ACTION_LABELS[log.g3_final_action!] ?? log.g3_final_action}
                              </div>
                            )}
                            {!g2Changed && !g3Changed && (
                              <Badge variant="default">G3 重排未改</Badge>
                            )}
                          </>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      {/* 执行状态 */}
                      <td className="py-2 pr-3">
                        <span
                          className={`px-1.5 py-0.5 rounded text-xs font-medium ${statusInfo.color}`}
                        >
                          {statusInfo.label}
                        </span>
                      </td>
                      {/* routing_success */}
                      <td className="py-2 pr-3">
                        {log.routing_success === null ? (
                          <span className="text-gray-300">—</span>
                        ) : log.routing_success ? (
                          <span className="text-green-500">✅</span>
                        ) : (
                          <span className="text-red-400">❌</span>
                        )}
                      </td>
                      {/* execution_correct */}
                      <td className="py-2 pr-3">
                        {log.execution_correct === null ? (
                          <span className="text-gray-300">—</span>
                        ) : log.execution_correct ? (
                          <span className="text-green-500">✅</span>
                        ) : (
                          <span className="text-red-400">❌</span>
                        )}
                      </td>
                      {/* value_success */}
                      <td className="py-2 pr-3">
                        {log.value_success === null ? (
                          <span className="text-gray-300">—</span>
                        ) : log.value_success ? (
                          <span className="text-green-500">✅</span>
                        ) : (
                          <span className="text-red-400">❌</span>
                        )}
                      </td>
                      {/* user_success */}
                      <td className="py-2 pr-3">
                        {log.user_success === null ? (
                          <span className="text-gray-300">—</span>
                        ) : log.user_success ? (
                          <span className="text-green-500">✅</span>
                        ) : (
                          <span className="text-red-400">❌</span>
                        )}
                      </td>
                      {/* 置信度 */}
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-1">
                          <div className="w-12 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-400 rounded-full"
                              style={{ width: `${Math.round(log.system_confidence * 100)}%` }}
                            />
                          </div>
                          <span className="font-mono text-gray-500 w-8 text-right">
                            {Math.round(log.system_confidence * 100)}%
                          </span>
                        </div>
                      </td>
                      {/* 延迟 */}
                      <td className="py-2 pr-3 text-gray-500 font-mono">
                        {log.latency_ms !== null ? `${log.latency_ms}ms` : "—"}
                      </td>
                      {/* 费用 */}
                      <td className="py-2 pr-3 text-gray-500 font-mono">
                        {log.cost_usd !== null ? `$${log.cost_usd.toFixed(4)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
