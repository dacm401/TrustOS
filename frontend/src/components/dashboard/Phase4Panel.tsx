"use client";
/**
 * Phase4Panel — Sprint 76
 *
 * 展示 Phase 4 (Local Trust Gateway) 功能开关的当前状态：
 * - Permission Layer / Data Classification / Redaction / Small Model Guard
 * - Layer 2 灰度比例
 * - Embedding 缓存命中率
 * - LLM Circuit Breaker 状态
 *
 * 只读面板（后端 config 由环境变量控制，不支持运行时修改）。
 */

import { useState, useEffect } from "react";
import { getApiConfig } from "@/lib/api";

interface Phase4Config {
  permission_enabled: boolean;
  data_classification_enabled: boolean;
  redaction_enabled: boolean;
  small_model_guard_enabled: boolean;
  user_data_preferences: {
    allowCloudConversationHistory: boolean;
    allowCloudMemory: boolean;
    allowCloudToolResults: boolean;
  };
  layer2_enabled: boolean;
  layer2_rollout: number;
}

interface CircuitBreakerStats {
  state: "closed" | "open" | "half-open";
  failureCount: number;
  successCount: number;
  nextAttempt: number | null;
}

interface SystemStats {
  embedding_cache: {
    size: number;
    maxSize: number;
    hits: number;
    misses: number;
    hitRate: string;
  };
  circuit_breakers: {
    llm: CircuitBreakerStats;
    database: CircuitBreakerStats;
  };
}

function Badge({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{
        backgroundColor: on ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.12)",
        color: on ? "#16a34a" : "#dc2626",
        border: `1px solid ${on ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.25)"}`,
      }}
    >
      <span>{on ? "●" : "○"}</span>
      {label}
    </span>
  );
}

function CircuitBreakerBadge({ stats }: { stats: CircuitBreakerStats }) {
  const colorMap = {
    closed: { bg: "rgba(34,197,94,0.15)", fg: "#16a34a", border: "rgba(34,197,94,0.3)" },
    open: { bg: "rgba(239,68,68,0.12)", fg: "#dc2626", border: "rgba(239,68,68,0.25)" },
    "half-open": { bg: "rgba(234,179,8,0.12)", fg: "#ca8a04", border: "rgba(234,179,8,0.25)" },
  } as const;
  const c = colorMap[stats.state];
  const retryIn = stats.nextAttempt ? Math.max(0, Math.ceil((stats.nextAttempt - Date.now()) / 1000)) : null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: c.bg, color: c.fg, border: `1px solid ${c.border}` }}
      title={`failures=${stats.failureCount}${retryIn ? ` retry_in=${retryIn}s` : ""}`}
    >
      {stats.state === "closed" ? "✔ closed" : stats.state === "open" ? `✖ open${retryIn ? ` (${retryIn}s)` : ""}` : "◐ half-open"}
    </span>
  );
}

export function Phase4Panel() {
  const [phase4, setPhase4] = useState<Phase4Config | null>(null);
  const [sysStats, setSysStats] = useState<SystemStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  async function fetchData() {
    const { apiBase } = await getApiConfig();
    try {
      const [p4Res, statsRes] = await Promise.all([
        fetch(`${apiBase}/api/config/phase4`),
        fetch(`${apiBase}/api/system/stats`),
      ]);
      if (p4Res.ok) setPhase4(await p4Res.json());
      if (statsRes.ok) setSysStats(await statsRes.json());
      setLastUpdated(new Date());
    } catch {
      // fail silently — panel is purely informational
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
    // auto-refresh every 30s for circuit breaker state
    const id = setInterval(fetchData, 30_000);
    return () => clearInterval(id);
  }, []);

  const cardStyle = {
    backgroundColor: "var(--bg-surface)",
    border: "1px solid var(--border-subtle)",
  };

  if (loading) {
    return (
      <div className="rounded-xl p-5 text-sm" style={{ ...cardStyle, color: "var(--text-muted)" }}>
        加载系统状态...
      </div>
    );
  }

  return (
    <div className="rounded-xl p-5" style={cardStyle}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
            系统状态
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            Phase 4 开关 + 运行时指标
          </div>
        </div>
        {lastUpdated && (
          <button
            onClick={fetchData}
            className="text-xs px-2 py-1 rounded"
            style={{ color: "var(--text-muted)", backgroundColor: "var(--bg-subtle)" }}
            title={`上次更新: ${lastUpdated.toLocaleTimeString()}`}
          >
            ↺ 刷新
          </button>
        )}
      </div>

      {/* Phase 4 Feature Flags */}
      {phase4 && (
        <div className="mb-4">
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Local Trust Gateway (Phase 4)
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge on={phase4.permission_enabled} label="Permission Layer" />
            <Badge on={phase4.data_classification_enabled} label="Data Classification" />
            <Badge on={phase4.redaction_enabled} label="Redaction" />
            <Badge on={phase4.small_model_guard_enabled} label="SmallModel Guard" />
          </div>

          {/* User data preferences */}
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge on={phase4.user_data_preferences.allowCloudConversationHistory} label="云端对话历史" />
            <Badge on={phase4.user_data_preferences.allowCloudMemory} label="云端记忆" />
            <Badge on={phase4.user_data_preferences.allowCloudToolResults} label="云端工具结果" />
          </div>
        </div>
      )}

      {/* Layer 2 rollout */}
      {phase4 && (
        <div className="mb-4">
          <div className="text-xs font-medium mb-1" style={{ color: "var(--text-secondary)" }}>
            Layer 2 灰度
          </div>
          <div className="flex items-center gap-3">
            <Badge on={phase4.layer2_enabled} label={`Layer2 ${phase4.layer2_enabled ? "ON" : "OFF"}`} />
            <div className="flex-1">
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--border-subtle)" }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(phase4.layer2_rollout * 100)}%`,
                    backgroundColor: phase4.layer2_enabled ? "#3b82f6" : "#9ca3af",
                  }}
                />
              </div>
            </div>
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              {Math.round(phase4.layer2_rollout * 100)}%
            </span>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="mb-3" style={{ borderTop: "1px solid var(--border-subtle)" }} />

      {/* Circuit Breakers */}
      {sysStats && (
        <div className="mb-3">
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Circuit Breaker
          </div>
          <div className="flex gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>LLM</span>
              <CircuitBreakerBadge stats={sysStats.circuit_breakers.llm} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>DB</span>
              <CircuitBreakerBadge stats={sysStats.circuit_breakers.database} />
            </div>
          </div>
        </div>
      )}

      {/* Embedding Cache */}
      {sysStats && (
        <div>
          <div className="text-xs font-medium mb-2" style={{ color: "var(--text-secondary)" }}>
            Embedding 缓存
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "命中率", value: sysStats.embedding_cache.hitRate },
              { label: "缓存条数", value: `${sysStats.embedding_cache.size}/${sysStats.embedding_cache.maxSize}` },
              {
                label: "命中/未中",
                value: `${sysStats.embedding_cache.hits}/${sysStats.embedding_cache.misses}`,
              },
            ].map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg p-2 text-center"
                style={{ backgroundColor: "var(--bg-subtle)" }}
              >
                <div className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  {value}
                </div>
                <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!phase4 && !sysStats && (
        <div className="text-xs" style={{ color: "var(--text-muted)" }}>
          ⚠️ 无法获取系统状态，后端可能未启动
        </div>
      )}
    </div>
  );
}
