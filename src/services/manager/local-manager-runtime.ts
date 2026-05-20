// Sprint 63P: Local Manager Mode V0
// 目标：把 Manager Control Plane 从"远端模型角色"拆为"本地控制平面 + 可选远端 LLM"
//
// 核心原则：
// - Local Manager 永远先运行
// - 安全决策必须本地化（不交给远端模型）
// - Manager LLM 变成可选 fallback
// - 不改变现有 S60P/S61P/S62P 行为

import { v4 as uuid } from "uuid";
import { evaluateExecutionPolicy } from "../policy/execution-policy.js";
import type { ActiveArtifactContext } from "../context/active-artifact.js";
import type { ExecutionPolicyRoute } from "../../types/call-ledger.js";
// Sprint 66P: Quality-aware Routing
import type { QualityRoutingDecision } from "../verifier/verifier-types.js";

// ── LocalManagerDecision 类型 ────────────────────────────────────────────────

export type LocalManagerNextAction =
  | "direct_answer"
  | "direct_create_artifact"
  | "direct_artifact_revision"
  | "manager_llm_fallback"
  | "ask_clarification";

export interface LocalManagerSecurity {
  allowManagerRemote: boolean;
  allowWorkerRemote: boolean;
  allowArtifactToManager: boolean;
  allowArtifactToWorker: boolean;
  allowRawHistoryToWorker: boolean;
  allowRawMemoryToWorker: boolean;
}

export interface LocalManagerDecision {
  /** traceId —— 和请求的 traceId 一致 */
  traceId: string;
  /** 模式：V0 始终为 local_control_plane */
  managerMode: "local_control_plane";
  /** 是否仍需远端 Manager LLM */
  managerLlmRequired: boolean;
  /** 若为 true，说明为什么需要 */
  managerLlmReason?: string;
  /** Execution Policy 路由结果 */
  policyRoute: ExecutionPolicyRoute;
  /** 下一步动作 */
  nextAction: LocalManagerNextAction;
  /** 是否需要 ContextPackage */
  contextPackageRequired: boolean;
  /** 是否适合 patch-first（仅 revision 时）——向后兼容字段 */
  patchFirstEligible: boolean;
  /** Sprint 68P: 显式 patch-first 最终 eligibility（等同于 patchFirstAfter） */
  effectivePatchFirstEligible: boolean;
  /** Sprint 67P: 质量路由决策前，patch-first 初始 eligibility（降级前快照） */
  patchFirstBefore: boolean;
  /** Sprint 67P: prefer_full_rewrite advisory 标记（soft preference，不强制降级） */
  patchFirstDegradedByWarning?: boolean;
  /** Sprint 68P: 别名 patchFirstDegradedByWarning，方便语义区分 */
  patchFirstWarningAdvisory?: boolean;
  /** Sprint 66P: force/block 强制降级标记 */
  patchFirstDowngradedByQuality?: boolean;
  /** Sprint 68P: 别名 patchFirstDowngradedByQuality，方便语义区分 */
  patchFirstHardDowngrade?: boolean;
  /** 安全决策（本地输出，不交给模型） */
  security: LocalManagerSecurity;
  /** 决策耗时 ms */
  decisionMs: number;
  /** 决策理由 */
  reason: string;
}

// ── runLocalManager ──────────────────────────────────────────────────────────

export interface RunLocalManagerInput {
  traceId: string;
  userInstruction: string;
  activeArtifact?: ActiveArtifactContext;
  /** Sprint 66P: 上一次 quality routing 决策（来自 extractLastVerificationFromHistory） */
  qualityRouting?: QualityRoutingDecision | null;
}

/**
 * Local Manager Mode V0：
 * 规则 + metadata + policy + security scope 全部本地执行。
 * 不调任何 LLM，不访问 DB，纯同步计算。
 *
 * V0 原则：
 * - 安全靠代码，不靠模型自觉
 * - Manager 永远先运行
 * - 决策结果可审计（decisionMs / reason / security）
 *
 * Sprint 66P 扩展：
 * - 接受可选 qualityRouting hint
 * - 若 decision 为 force_full_rewrite / block_or_full_rewrite，降级 patchFirstEligible
 */
export function runLocalManager(
  input: RunLocalManagerInput
): LocalManagerDecision {
  const start = Date.now();
  const { traceId, userInstruction, activeArtifact, qualityRouting } = input;

  // 1. 运行 Execution Policy（规则先于 LLM）
  const policyDecision = evaluateExecutionPolicy(
    userInstruction,
    activeArtifact
  );

  // 2. 确定 nextAction 和 managerLlmRequired
  const nextAction = policyRouteToNextAction(policyDecision.route);
  const managerLlmRequired = policyDecision.managerLlmRequired;

  const decisionMs = Date.now() - start;

  // 3. 安全决策（本地硬编码，V0 简化但完整）
  // 这些不交给远端模型判断——安全靠代码，不靠模型自觉
  const security: LocalManagerSecurity = {
    // Context Boundary 不变量：Manager Remote 不接收 artifact 原文
    allowManagerRemote: !managerLlmRequired,
    allowWorkerRemote: true,
    allowArtifactToManager: false, // 红线：artifact 原文绝不发给 Manager
    // revision 时 artifact 原文发给 Worker；create/delegation 时不发
    allowArtifactToWorker:
      nextAction === "direct_artifact_revision" &&
      Boolean(activeArtifact),
    // Context Boundary 不变量：raw history 不发 Worker
    allowRawHistoryToWorker: false,
    // Memory 不发给 Worker（V0 简化）
    allowRawMemoryToWorker: false,
  };

  // 4. patchFirstEligible：仅 revision 且 policy 已 bypass
  const patchFirstBefore =
    nextAction === "direct_artifact_revision" && !managerLlmRequired;

  // 5. Quality-aware Routing 降级逻辑（Sprint 67P）
  let patchFirstEligible = patchFirstBefore;
  let patchFirstDowngradedByQuality = false;
  let patchFirstDegradedByWarning = false;

  if (patchFirstBefore && qualityRouting?.enabled) {
    if (
      qualityRouting.decision === "force_full_rewrite" ||
      qualityRouting.decision === "block_or_full_rewrite"
    ) {
      // Hard downgrade: 强制降级 patch-first
      patchFirstEligible = false;
      patchFirstDowngradedByQuality = true;
      console.log(
        `[local-manager] patchFirstEligible hard-downgraded by quality routing: decision=${qualityRouting.decision}, reason=${qualityRouting.reason}`
      );
    } else if (qualityRouting.decision === "prefer_full_rewrite") {
      // Advisory: soft preference，不强制降级，但标记 advisory 状态
      patchFirstDegradedByWarning = true;
      patchFirstEligible = patchFirstBefore; // 保持 true（V0 advisory）
      console.log(
        `[local-manager] patch-first advisory signal: decision=prefer_full_rewrite, degradedByWarning=true`
      );
    }
  }

  // S68P: effectivePatchFirstEligible = patchFirstEligible（显式最终状态，等同于 patchFirstAfter）
  const effectivePatchFirstEligible = patchFirstEligible;

  return {
    traceId,
    managerMode: "local_control_plane",
    managerLlmRequired,
    managerLlmReason: managerLlmRequired
      ? policyDecision.reason
      : undefined,
    policyRoute: policyDecision.route,
    nextAction,
    contextPackageRequired:
      nextAction === "direct_create_artifact" ||
      nextAction === "direct_artifact_revision" ||
      nextAction === "manager_llm_fallback",
    patchFirstEligible,
    effectivePatchFirstEligible,
    patchFirstBefore,
    patchFirstDegradedByWarning,
    patchFirstWarningAdvisory: patchFirstDegradedByWarning,
    patchFirstDowngradedByQuality,
    patchFirstHardDowngrade: patchFirstDowngradedByQuality,
    security,
    decisionMs,
    reason: policyDecision.reason,
  };
}

// ── 工具函数 ─────────────────────────────────────────────────────────────────

/** 从 ExecutionPolicyRoute 映射到 LocalManagerNextAction */
function policyRouteToNextAction(
  route: ExecutionPolicyRoute
): LocalManagerNextAction {
  switch (route) {
    case "direct_artifact_revision":
      return "direct_artifact_revision";
    case "direct_create_artifact":
      return "direct_create_artifact";
    case "local_answer_from_meta":
      return "direct_answer";
    case "manager_llm_required":
      return "manager_llm_fallback";
    case "ask_clarification":
      return "ask_clarification";
    default:
      return "manager_llm_fallback";
  }
}

/** 从 LocalManagerDecision 提取 ledger 摘要字段 */
export function localManagerToLedgerExtract(
  lm: LocalManagerDecision
): Record<string, unknown> {
  return {
    enabled: true,
    mode: lm.managerMode,
    policyRoute: lm.policyRoute,
    managerLlmRequired: lm.managerLlmRequired,
    managerLlmBypassed: !lm.managerLlmRequired,
    nextAction: lm.nextAction,
    patchFirstEligible: lm.patchFirstEligible,
    effectivePatchFirstEligible: lm.effectivePatchFirstEligible,
    patchFirstBefore: lm.patchFirstBefore,
    patchFirstDegradedByWarning: lm.patchFirstDegradedByWarning ?? false,
    patchFirstWarningAdvisory: lm.patchFirstWarningAdvisory ?? false,
    patchFirstDowngradedByQuality: lm.patchFirstDowngradedByQuality ?? false,
    patchFirstHardDowngrade: lm.patchFirstHardDowngrade ?? false,
    decisionMs: lm.decisionMs,
  };
}

export { evaluateExecutionPolicy };

