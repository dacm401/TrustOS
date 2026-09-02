// SmartRouter Pro — Memory Types (MC-001)
// 依赖：task.ts (MemoryEntry)

import type { MemoryEntry } from "./task.js";

// ── Memory Retrieval (MR-001) ────────────────────────────────────────────────

/**
 * Context signal passed into the retrieval pipeline.
 * Currently lightweight: userMessage for keyword extraction,
 * with room to extend to embeddings or topic signals in MR-003.
 */
export interface MemoryRetrievalContext {
  /** The raw user message from the chat request */
  userMessage: string;
  /** Optional explicit keyword signals for retrieval (MR-003 may auto-extract) */
  keywords?: string[];
}

/**
 * A memory entry with a computed retrieval score and human-readable reason.
 * Used by the v2 retrieval pipeline.
 */
export interface MemoryRetrievalResult {
  entry: MemoryEntry;
  /** Composite score (higher = more relevant). Range not normalized. */
  score: number;
  /** Plain-language reason for the score, useful for debugging */
  reason: string;
  /**
   * 向量余弦相似度（0–1），与 `score` 是两回事。
   *
   * `score` 是「向量 + 重要度 + 时效性 + 关键词」的**综合评分**（量级 0~100，
   * 未归一化）；这里才是纯向量相似度，供注入引擎做相关性阈值判断。
   *
   * 二者曾被混用：调用方把 score  clamp 到 [0,1] 当相似度，导致 44、48 这类
   * 分数全部变成 1.00 —— 引擎判定「所有候选无区分度」而退化成关键词重算，
   * 相关性恒为 0，只有 inject:"always" 的规则还能命中。
   *
   * 无向量时（embedding 不可用或该条目尚未生成向量）为 undefined。
   */
  similarity?: number;
}

/**
 * Per-category injection policy for the retrieval pipeline.
 * Controls which memories are eligible for injection based on category.
 */
export interface MemoryCategoryPolicy {
  /** Minimum importance level required for this category to be injected (1–5) */
  minImportance: number;
  /** If true, inject up to `maxCount` memories from this category regardless of score */
  alwaysInject: boolean;
  /** Max number of entries to inject from this category (default: 2) */
  maxCount?: number;
}

// ── Evidence System (Layer 6 / E1) ─────────────────────────────────────────

/** Source of an evidence record — the retrieval method that produced it */
export type EvidenceSource = "web_search" | "http_request" | "manual";

export interface Evidence {
  evidence_id: string;
  task_id: string;
  user_id: string;
  source: EvidenceSource;
  content: string;
  source_metadata: Record<string, unknown> | null;
  relevance_score: number | null;
  created_at: string;  // ISO 8601 string (outward API)
}

export interface EvidenceInput {
  task_id: string;
  user_id: string;
  source: EvidenceSource;
  content: string;
  source_metadata?: Record<string, unknown>;
  relevance_score?: number;
}
