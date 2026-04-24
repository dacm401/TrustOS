/**
 * Field Classification Map — T3-2
 *
 * TrustOS 所有数据表/字段的敏感级别标注。
 * 配合 PolicyEngine 使用：source 字段匹配 → 直接返回分类。
 */

import type { DataClassification } from "./policy-engine.js";

export type TableName =
  | "task_archives"
  | "task_commands"
  | "task_worker_results"
  | "task_archive_events"
  | "delegation_archives"
  | "memory_entries"
  | "feedback_events"
  | "decision_logs";

export type FieldKey = string; // e.g. "task_commands.task" or "task_commands.user_preference_summary"

/** 完整字段分类表（TableName.FieldName → Classification） */
export const FIELD_CLASSIFICATION: Record<FieldKey, DataClassification> = {
  // ── task_archives ────────────────────────────────────────────────────────────
  "task_archives.task_id": "public",          // UUID，无隐私
  "task_archives.session_id": "internal",      // 会话 ID，内部标识
  "task_archives.user_input": "confidential",  // 用户原始输入，可能含敏感内容
  "task_archives.fast_observations": "confidential", // Fast 提取的事实，可能含用户信息
  "task_archives.status": "internal",          // 状态枚举，无隐私
  "task_archives.delivered": "internal",       // 布尔标记，无隐私
  "task_archives.created_at": "internal",      // 时间戳，无隐私
  "task_archives.updated_at": "internal",

  // ── task_commands ────────────────────────────────────────────────────────────
  "task_commands.task_id": "public",
  "task_commands.action": "internal",         // action type 枚举
  "task_commands.task": "confidential",       // 任务描述，可能含上下文
  "task_commands.constraints": "internal",     // 约束列表，技术数据
  "task_commands.query_keys": "internal",      // 关键词列表
  "task_commands.relevant_facts": "confidential", // Fast 提取的事实，可能含隐私
  "task_commands.user_preference_summary": "strictly_private", // 用户偏好，最敏感
  "task_commands.priority": "internal",
  "task_commands.max_execution_time_ms": "internal",

  // ── task_worker_results ─────────────────────────────────────────────────────
  "task_worker_results.id": "public",
  "task_worker_results.task_id": "public",
  "task_worker_results.result": "internal",   // Worker 输出给用户，无隐私
  "task_worker_results.started_at": "internal",
  "task_worker_results.completed_at": "internal",
  "task_worker_results.processing_ms": "internal",
  "task_worker_results.deviations": "internal", // 偏差记录，技术数据

  // ── task_archive_events ─────────────────────────────────────────────────────
  "task_archive_events.id": "public",
  "task_archive_events.archive_id": "public",
  "task_archive_events.event_type": "internal",
  "task_archive_events.event_data": "internal", // JSON，技术数据
  "task_archive_events.created_at": "internal",

  // ── delegation_archives ─────────────────────────────────────────────────────
  "delegation_archives.task_id": "public",
  "delegation_archives.user_id": "strictly_private", // 用户 ID，最敏感
  "delegation_archives.session_id": "internal",
  "delegation_archives.original_message": "confidential", // 用户原始消息
  "delegation_archives.delegation_prompt": "internal", // 发给 Worker 的 prompt
  "delegation_archives.slow_result": "internal",
  "delegation_archives.processing_ms": "internal",
  "delegation_archives.created_at": "internal",
  "delegation_archives.status": "internal",

  // ── memory_entries ──────────────────────────────────────────────────────────
  "memory_entries.id": "public",
  "memory_entries.user_id": "strictly_private",
  "memory_entries.content": "confidential", // 记忆内容，可能含用户偏好
  "memory_entries.category": "internal",
  "memory_entries.importance": "internal",
  "memory_entries.source": "internal",
  "memory_entries.created_at": "internal",
  "memory_entries.last_accessed": "internal",

  // ── feedback_events ─────────────────────────────────────────────────────────
  "feedback_events.id": "public",
  "feedback_events.decision_id": "public",
  "feedback_events.user_id": "strictly_private",
  "feedback_events.signal_type": "internal",
  "feedback_events.signal_level": "internal",
  "feedback_events.feedback_score": "internal",
  "feedback_events.created_at": "internal",

  // ── decision_logs ────────────────────────────────────────────────────────────
  "decision_logs.id": "public",
  "decision_logs.user_id": "strictly_private",
  "decision_logs.session_id": "internal",
  "decision_logs.model_used": "internal",
  "decision_logs.feedback_score": "internal",
  "decision_logs.created_at": "internal",
};

/**
 * 根据表名和字段名查分类
 * @param table e.g. "task_commands"
 * @param field e.g. "user_preference_summary"
 */
export function getFieldClassification(table: TableName, field: string): DataClassification {
  return FIELD_CLASSIFICATION[`${table}.${field}`] ?? "internal";
}

/**
 * 获取某张表的所有 confidential 或以上级别字段
 */
export function getSensitiveFields(table: TableName): FieldKey[] {
  const prefix = `${table}.`;
  return (Object.keys(FIELD_CLASSIFICATION) as FieldKey[])
    .filter((key) => key.startsWith(prefix))
    .filter((key) => {
      const cls = FIELD_CLASSIFICATION[key];
      return cls === "confidential" || cls === "strictly_private";
    });
}

/**
 * 获取 strict 级别字段（永远不能上云的字段）
 */
export function getStrictlyPrivateFields(): FieldKey[] {
  return (Object.keys(FIELD_CLASSIFICATION) as FieldKey[])
    .filter((key) => FIELD_CLASSIFICATION[key] === "strictly_private");
}

/**
 * 工厂函数：构建 SourceBasedClassifier 初始化 map
 */
export function buildClassificationMap(): Record<string, DataClassification> {
  return { ...FIELD_CLASSIFICATION };
}
