/**
 * Sprint 62P: Patch-first Revision V0
 *
 * 类型定义：PatchOperation / PatchPlan / PatchabilityDecision
 *
 * V0 目标：patch-first, fallback-safe
 * - 能 patch 就 patch
 * - patch 不稳就 fallback full rewrite
 * - 无论如何用户不失败
 * - 无论如何 ledger 记清楚
 * - 无论如何安全边界不破
 */

/** 单个 patch 操作 */
export type PatchOperation =
  | {
      op: "replace";
      /** 在源代码中精确查找的字符串（必须唯一命中） */
      find: string;
      /** 替换后的字符串 */
      replace: string;
      /** 修改原因（可选，用于 ledger trace） */
      reason?: string;
    }
  | {
      op: "insert_after";
      /** 在此字符串之后插入 */
      find: string;
      /** 插入的内容 */
      insert: string;
      reason?: string;
    }
  | {
      op: "insert_before";
      /** 在此字符串之前插入 */
      find: string;
      /** 插入的内容 */
      insert: string;
      reason?: string;
    };

/** Worker 输出的 patch 计划 */
export interface PatchPlan {
  /** 唯一 patch ID */
  patchId: string;
  /** 关联的 trace ID */
  traceId: string;
  /** 目标 artifact ID */
  targetArtifactId: string;
  /** 用户修订指令原文 */
  revisionInstruction: string;
  /** patch 操作列表 */
  operations: PatchOperation[];
  /** Worker 对 patch 成功率的置信度 (0~1) */
  confidence: number;
  /** 是否应 fallback 到 full rewrite */
  fallbackToFullRewrite: boolean;
}

/** patch 应用结果 */
export interface PatchResult {
  /** 是否完全成功 */
  ok: boolean;
  /** patch 后的完整内容（成功时存在） */
  content?: string;
  /** 错误信息（失败时存在） */
  errors?: string[];
  /** 成功应用的操作数 */
  appliedOperations: number;
  /** 总操作数 */
  totalOperations: number;
  /** patch 前后的字节数变化 */
  sourceBytes: number;
  outputBytes: number;
}

/** 小修订可 patch 性判定 */
export interface PatchabilityDecision {
  /** 是否可 patch */
  patchable: boolean;
  /** 判定理由 */
  reason: string;
  /** 置信度 (0~1) */
  confidence: number;
  /** patch 模式 */
  patchMode?: "style" | "text" | "small_structure";
}

/** ledger patch 字段 */
export interface PatchLedgerEntry {
  /** 是否尝试了 patch */
  attempted: boolean;
  /** patch 是否成功应用 */
  applied: boolean;
  /** 是否 fallback 到 full rewrite */
  fallbackToFullRewrite: boolean;
  /** fallback 原因 */
  fallbackReason?: string;
  /** 成功应用的操作数 */
  operationCount?: number;
  /** patch 模式 */
  patchMode?: "style" | "text" | "small_structure";
  /** 源内容字节数 */
  sourceBytes: number;
  /** 输出内容字节数 */
  outputBytes: number;
}
