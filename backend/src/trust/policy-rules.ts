/**
 * TrustPolicy 默认规则集 — T3-1
 *
 * 内建策略规则，覆盖常见信任边界场景。
 * 所有规则按优先级从高到低排列（deny > ask_user > transform > allow）。
 */

import type { PolicyRule, PolicyCheckRequest, DataClassification } from "./policy-engine.js";

// ── 辅助函数 ──────────────────────────────────────────────────────────────────

/** 检查请求是否发往指定 recipient */
const isRecipient = (req: PolicyCheckRequest, ...recipients: PolicyCheckRequest["recipient"][]): boolean =>
  recipients.includes(req.recipient);

/** 检查分类是否在指定范围内 */
const isClassification = (classification: DataClassification, ...levels: DataClassification[]): boolean =>
  levels.includes(classification);

// ── 默认规则 ──────────────────────────────────────────────────────────────────

/**
 * Rule 1: strictly_private 数据永不上云（deny）
 * 适用场景：password / token / email / phone / 身份证 / 银行卡 等
 */
export const RULE_STRICTLY_PRIVATE_NO_CLOUD: PolicyRule = {
  id: "strictly-private-no-cloud",
  description: "strictly_private 级别数据禁止传输到云端（slow_worker 或 external_api）",
  condition: (req, classification) =>
    isClassification(classification, "strictly_private") &&
    isRecipient(req, "slow_worker", "external_api"),
  decision: {
    decision: "deny",
    reason: "strictly_private 数据禁止传输到云端",
  },
};

/**
 * Rule 2: confidential 数据发给云端需用户确认（ask_user）
 * 适用场景：用户消息 / 记忆 / 偏好摘要 / relevant_facts
 */
export const RULE_CONFIDENTIAL_CLOUD需CONFIRM: PolicyRule = {
  id: "confidential-cloud-confirm",
  description: "confidential 数据发给云端（slow_worker）需要用户明确授权",
  condition: (req, classification) =>
    isClassification(classification, "confidential") &&
    isRecipient(req, "slow_worker"),
  decision: {
    decision: "ask_user",
    prompt: "即将发送部分个人信息给云端模型处理，是否继续？\n\n如选择继续，云端模型将仅用于执行当前任务，不会保留这些信息。",
  },
};

/**
 * Rule 3: 外部 API 调用永远需要用户确认（ask_user）
 * 适用场景：任何 recipient=external_api 的请求
 */
export const RULE_EXTERNAL_API_ALWAYS_CONFIRM: PolicyRule = {
  id: "external-api-always-confirm",
  description: "外部 API 调用需要用户明确授权",
  condition: (req) => isRecipient(req, "external_api"),
  decision: {
    decision: "ask_user",
    prompt: "应用需要访问外部服务，是否继续？",
  },
};

/**
 * Rule 4: internal/public 数据直接放行（allow）
 * 适用场景：Task Brief 的 action / constraints / query_keys / result 等
 */
export const RULE_INTERNAL_ALLOW: PolicyRule = {
  id: "internal-allow",
  description: "internal 和 public 数据直接放行",
  condition: (req, classification) =>
    isClassification(classification, "internal", "public"),
  decision: {
    decision: "allow",
  },
};

/**
 * Rule 5: Worker 结果发给用户无需额外确认（allow）
 * Worker 输出本身无隐私风险，直接放行
 */
export const RULE_RESULT_TO_USER_ALLOW: PolicyRule = {
  id: "result-to-user-allow",
  description: "Worker 结果发送给用户无需确认",
  condition: (req) =>
    req.dataType === "result" && isRecipient(req, "user"),
  decision: {
    decision: "allow",
  },
};

/**
 * Rule 6: Fast Manager 内部数据无需检查（allow）
 * Fast Manager 是本地层，信息流动在可信边界内
 */
export const RULE_FAST_MANAGER_INTERNAL: PolicyRule = {
  id: "fast-manager-internal",
  description: "Fast Manager 内部数据流动无需策略检查",
  condition: (req) => isRecipient(req, "fast_manager"),
  decision: {
    decision: "allow",
  },
};

/**
 * Rule 7: 无 source 字段且无明确分类的 memory 类型数据 → confidential（推断）
 * 适用于从 history/memory 中提取的未标注数据
 */
export const RULE_MEMORY_UNCLASSIFIED_CONFIDENTIAL: PolicyRule = {
  id: "memory-unclassified-confidential",
  description: "无分类标注的 memory 类型数据默认视为 confidential，发云端需确认",
  condition: (req) =>
    req.dataType === "memory" &&
    !req.source &&
    isRecipient(req, "slow_worker"),
  decision: {
    decision: "ask_user",
    prompt: "即将发送记忆中的个人信息给云端模型处理，是否继续？",
  },
};

// ── 默认规则集（按优先级排序）──────────────────────────────────────────────────

/** 默认规则集：deny → ask_user → transform → allow */
export const DEFAULT_POLICY_RULES: PolicyRule[] = [
  // 高优先级：deny
  RULE_STRICTLY_PRIVATE_NO_CLOUD,

  // 中优先级：ask_user（需要用户确认）
  RULE_CONFIDENTIAL_CLOUD需CONFIRM,
  RULE_EXTERNAL_API_ALWAYS_CONFIRM,
  RULE_MEMORY_UNCLASSIFIED_CONFIDENTIAL,

  // 低优先级：allow（放行）
  RULE_RESULT_TO_USER_ALLOW,
  RULE_FAST_MANAGER_INTERNAL,
  RULE_INTERNAL_ALLOW,
];

import { TrustPolicyEngine } from "./policy-engine.js";

/**
 * 创建默认策略引擎实例
 */
export function createDefaultPolicyEngine(): TrustPolicyEngine {
  return new TrustPolicyEngine(DEFAULT_POLICY_RULES);
}
