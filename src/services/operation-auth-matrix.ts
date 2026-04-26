/**
 * Sprint 65 — Operation Authorization Matrix
 *
 * 声明式定义"哪类操作必须走 Slow、哪类 Fast 可以直接处理"。
 *
 * 职责：
 *   1. 把 LLM 返回的 DecisionFeatures 映射到 OperationType
 *   2. 查矩阵判断 required_layer
 *   3. 当 LLM 决定 direct_answer / ask_clarification 但矩阵要求 slow 时，强制上升
 *
 * 设计原则：
 *   - Fast = 管家/门卫：判断、调度、整合，低成本轻量操作
 *   - Slow = 执行者：外部调用、副作用操作、深度推理、高风险
 *   - 矩阵规则 > LLM 自报分数（安全优先）
 */

import type { DecisionFeatures, ManagerDecisionType } from "../types/index.js";

// ── 操作类型枚举 ───────────────────────────────────────────────────────────────

export enum OperationType {
  // Fast 直接处理
  SIMPLE_QA          = "simple_qa",
  TEXT_DRAFT         = "text_draft",
  CODE_REVIEW        = "code_review",
  FORMAT_CONVERT     = "format_convert",
  GREETING           = "greeting",

  // 自动：LLM 决策，矩阵做安全校验
  ANALYSIS           = "analysis",
  MULTI_STEP         = "multi_step",
  CROSS_SESSION      = "cross_session",

  // 强制 Slow
  WEB_SEARCH         = "web_search",
  API_CALL           = "api_call",
  FILE_WRITE         = "file_write",
  CODE_EXECUTION     = "code_execution",
  DEEP_REASONING     = "deep_reasoning",
  FINANCIAL_OP       = "financial_op",
  PII_ACCESS         = "pii_access",
  HIGH_RISK          = "high_risk",
}

// ── 授权层级 ───────────────────────────────────────────────────────────────────

export type RequiredLayer = "fast" | "slow" | "auto";

export interface OperationPolicy {
  type: OperationType;
  required_layer: RequiredLayer;
  /** 可以让 Fast 汇总 Slow 的结果？（summarize 不等于 execute） */
  fast_can_summarize: boolean;
  /** 需要 PermissionRequest 才能访问用户数据？ */
  requires_permission: boolean;
  /** 人类可读说明 */
  reason: string;
  /** 示例 */
  examples: string[];
}

// ── 操作矩阵 ──────────────────────────────────────────────────────────────────

export const OPERATION_MATRIX: Readonly<Record<OperationType, OperationPolicy>> = {
  [OperationType.SIMPLE_QA]: {
    type: OperationType.SIMPLE_QA,
    required_layer: "fast",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "简单问答，Fast 直接回答",
    examples: ["今天几号", "什么是 REST API", "帮我解释一下这段话"],
  },
  [OperationType.TEXT_DRAFT]: {
    type: OperationType.TEXT_DRAFT,
    required_layer: "fast",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "文本起草，Fast 可以直接生成初稿",
    examples: ["帮我写一封道歉邮件", "起草一个产品说明"],
  },
  [OperationType.CODE_REVIEW]: {
    type: OperationType.CODE_REVIEW,
    required_layer: "fast",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "代码审查/建议，不需要执行，Fast 可以处理",
    examples: ["这段代码有问题吗", "帮我看看这个函数"],
  },
  [OperationType.FORMAT_CONVERT]: {
    type: OperationType.FORMAT_CONVERT,
    required_layer: "fast",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "格式转换/结构化，纯文本操作",
    examples: ["把这个 JSON 转成表格", "把日期格式改成 YYYY-MM-DD"],
  },
  [OperationType.GREETING]: {
    type: OperationType.GREETING,
    required_layer: "fast",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "问候/闲聊，直接回答",
    examples: ["你好", "早上好", "谢谢"],
  },
  [OperationType.ANALYSIS]: {
    type: OperationType.ANALYSIS,
    required_layer: "auto",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "分析任务，LLM 自行判断深度；浅层分析 Fast 可做，深度分析走 Slow",
    examples: ["分析这段业务逻辑", "给我一个市场分析报告"],
  },
  [OperationType.MULTI_STEP]: {
    type: OperationType.MULTI_STEP,
    required_layer: "slow",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "多步骤操作，需要 Slow 维持上下文和执行链",
    examples: ["帮我先查资料，再写摘要，再翻译成英文", "分步骤完成这个任务"],
  },
  [OperationType.CROSS_SESSION]: {
    type: OperationType.CROSS_SESSION,
    required_layer: "slow",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "跨会话续写，需要 Slow 读取历史上下文并延续任务",
    examples: ["继续上次的", "接着做", "把之前的方案补完"],
  },
  [OperationType.WEB_SEARCH]: {
    type: OperationType.WEB_SEARCH,
    required_layer: "slow",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "实时网络搜索，需要工具调用，Fast 不执行，只整合结果",
    examples: ["搜索一下今天的新闻", "查一下这个产品的价格"],
  },
  [OperationType.API_CALL]: {
    type: OperationType.API_CALL,
    required_layer: "slow",
    fast_can_summarize: true,
    requires_permission: true,
    reason: "外部 API 调用，涉及凭证和副作用，强制走 Slow",
    examples: ["帮我调一下这个接口", "查一下天气 API 的数据"],
  },
  [OperationType.FILE_WRITE]: {
    type: OperationType.FILE_WRITE,
    required_layer: "slow",
    fast_can_summarize: false,
    requires_permission: true,
    reason: "文件写入操作，具有副作用，必须明确授权",
    examples: ["把结果保存到文件", "写入数据库", "更新配置文件"],
  },
  [OperationType.CODE_EXECUTION]: {
    type: OperationType.CODE_EXECUTION,
    required_layer: "slow",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "代码执行，需要沙箱环境，Fast 不执行代码",
    examples: ["运行这段代码", "执行这个脚本", "帮我测试一下"],
  },
  [OperationType.DEEP_REASONING]: {
    type: OperationType.DEEP_REASONING,
    required_layer: "slow",
    fast_can_summarize: true,
    requires_permission: false,
    reason: "深度推理/长链思考，Slow 模型更擅长",
    examples: ["帮我深入分析这个问题", "给我一个详细的方案"],
  },
  [OperationType.FINANCIAL_OP]: {
    type: OperationType.FINANCIAL_OP,
    required_layer: "slow",
    fast_can_summarize: false,
    requires_permission: true,
    reason: "金融操作，高风险，必须主人确认 + Slow 执行",
    examples: ["帮我转账", "查一下我的账户余额", "订购商品"],
  },
  [OperationType.PII_ACCESS]: {
    type: OperationType.PII_ACCESS,
    required_layer: "slow",
    fast_can_summarize: false,
    requires_permission: true,
    reason: "访问个人身份信息，必须主人授权",
    examples: ["填写我的个人信息", "用我的手机号注册"],
  },
  [OperationType.HIGH_RISK]: {
    type: OperationType.HIGH_RISK,
    required_layer: "slow",
    fast_can_summarize: false,
    requires_permission: true,
    reason: "高风险操作（安全/医疗/法律/隐私），必须主人确认",
    examples: ["修改密码", "删除账户", "申请贷款"],
  },
};

// ── 特征 → 操作类型 映射 ───────────────────────────────────────────────────────

/**
 * 根据 LLM 返回的 DecisionFeatures 推断主操作类型。
 * 优先级从高到低（最高风险优先）。
 */
export function detectOperationType(
  features: DecisionFeatures,
  userMessage: string
): OperationType {
  const msg = userMessage.toLowerCase();

  // 高风险优先
  if (features.high_risk_action) {
    if (/银行|转账|汇款|取款|贷款|理财|股票|投资/i.test(msg)) return OperationType.FINANCIAL_OP;
    if (/密码|证件|护照|身份证|社保|医保|病历/i.test(msg)) return OperationType.HIGH_RISK;
    return OperationType.HIGH_RISK;
  }

  // PII 访问
  if (/手机号|邮箱|地址|姓名|出生日期|身份证号/i.test(msg)) {
    return OperationType.PII_ACCESS;
  }

  // 代码执行
  if (features.needs_external_tool && /执行|运行|跑一下|测试一下|run|exec/i.test(msg)) {
    return OperationType.CODE_EXECUTION;
  }

  // 文件写入
  if (features.needs_external_tool && /写入|保存|创建文件|写文件|存储/i.test(msg)) {
    return OperationType.FILE_WRITE;
  }

  // 外部工具
  if (features.needs_external_tool) {
    if (/搜索|查一下|查找|找一下|search/i.test(msg)) return OperationType.WEB_SEARCH;
    return OperationType.API_CALL;
  }

  // 跨会话
  if (features.is_continuation) return OperationType.CROSS_SESSION;

  // 多步骤
  if (features.requires_multi_step) return OperationType.MULTI_STEP;

  // 深度推理
  if (features.needs_long_reasoning) return OperationType.DEEP_REASONING;

  // 分析类
  if (/分析|比较|评估|研究|总结|报告/i.test(msg)) return OperationType.ANALYSIS;

  // 代码审查
  if (/这段代码|看看这个|review|检查一下/i.test(msg)) return OperationType.CODE_REVIEW;

  // 问候
  if (/^(你好|hi|hello|早上好|晚上好|谢谢|感谢|bye|再见)[！!。？?]?$/i.test(msg.trim())) {
    return OperationType.GREETING;
  }

  // 格式转换
  if (/转换|格式化|convert|format/i.test(msg)) return OperationType.FORMAT_CONVERT;

  // 文本起草
  if (/帮我写|起草|生成一份|写一个|写一封/i.test(msg)) return OperationType.TEXT_DRAFT;

  // 默认：简单问答
  return OperationType.SIMPLE_QA;
}

// ── 路由校验 ───────────────────────────────────────────────────────────────────

export interface AuthMatrixResult {
  operationType: OperationType;
  policy: OperationPolicy;
  /** LLM 决定的 action，可能被矩阵强制覆盖 */
  originalAction: ManagerDecisionType;
  /** 最终生效的 action */
  finalAction: ManagerDecisionType;
  /** 是否被矩阵覆盖（升级到 Slow） */
  escalated: boolean;
  escalationReason?: string;
}

/**
 * 校验 LLM 的路由决策是否符合操作授权矩阵。
 * 如果 LLM 决定 direct_answer 但操作需要 Slow，强制覆盖为 delegate_to_slow。
 */
export function validateWithAuthMatrix(
  originalAction: ManagerDecisionType,
  features: DecisionFeatures,
  userMessage: string
): AuthMatrixResult {
  const opType = detectOperationType(features, userMessage);
  const policy = OPERATION_MATRIX[opType];

  // auto → 不干预，以 LLM 决策为准
  if (policy.required_layer === "auto") {
    return {
      operationType: opType,
      policy,
      originalAction,
      finalAction: originalAction,
      escalated: false,
    };
  }

  // fast → LLM 已决策 fast 类（direct_answer / ask_clarification），不需要干预
  if (policy.required_layer === "fast") {
    return {
      operationType: opType,
      policy,
      originalAction,
      finalAction: originalAction,
      escalated: false,
    };
  }

  // slow → 检查 LLM 是否已经路由到 slow/execute
  const isAlreadySlow =
    originalAction === "delegate_to_slow" || originalAction === "execute_task";

  if (isAlreadySlow) {
    return {
      operationType: opType,
      policy,
      originalAction,
      finalAction: originalAction,
      escalated: false,
    };
  }

  // LLM 决定 fast（direct_answer / ask_clarification），但矩阵要求 slow
  // → 强制覆盖为 delegate_to_slow
  const escalationReason =
    `操作类型 [${opType}] 要求 Slow 层处理（${policy.reason}），` +
    `强制从 ${originalAction} 升级为 delegate_to_slow`;

  return {
    operationType: opType,
    policy,
    originalAction,
    finalAction: "delegate_to_slow",
    escalated: true,
    escalationReason,
  };
}

/**
 * 快捷方法：此操作是否需要 Slow？
 */
export function requiresSlow(features: DecisionFeatures, userMessage: string): boolean {
  const opType = detectOperationType(features, userMessage);
  const policy = OPERATION_MATRIX[opType];
  return policy.required_layer === "slow";
}

/**
 * 快捷方法：此操作是否需要 PermissionRequest？
 */
export function requiresPermission(features: DecisionFeatures, userMessage: string): boolean {
  const opType = detectOperationType(features, userMessage);
  return OPERATION_MATRIX[opType].requires_permission;
}
