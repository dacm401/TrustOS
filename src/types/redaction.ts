// ══════════════════════════════════════════════════════════════════════════════
// Phase 4.1: Data Classification + Permission Layer
// ══════════════════════════════════════════════════════════════════════════════

// ── 数据分类枚举 ─────────────────────────────────────────────────────────────

/**
 * 数据分类级别 — 控制数据暴露范围。
 * 用于 Permission Layer 做暴露决策。
 */
export enum DataClassification {
  /** 仅本地小模型可见，不暴露给云端 */
  LOCAL_ONLY = "local_only",
  /** 可生成摘要后暴露（摘要由本地小模型生成） */
  LOCAL_SUMMARY_SHAREABLE = "local_summary_shareable",
  /** 可直接发送给云端模型 */
  CLOUD_ALLOWED = "cloud_allowed",
}

// ── 分类上下文 ────────────────────────────────────────────────────────────────

/** 数据类型来源 */
export type DataSource = "user" | "system" | "third_party";

/** 数据敏感级别 */
export type SensitivityLevel = "public" | "internal" | "confidential" | "secret";

/**
 * 分类上下文 — 用于 DataClassifier 决定数据的分类级别。
 */
export interface ClassificationContext {
  /** 数据类型 */
  dataType:
    | "conversation_history"
    | "task_archive"
    | "memory"
    | "tool_result"
    | "user_profile"
    | "web_content"
    | "api_response";
  /** 敏感级别 */
  sensitivity: SensitivityLevel;
  /** 数据来源 */
  source: DataSource;
  /** 是否包含 PII（个人身份信息） */
  hasPII: boolean;
  /** 数据年龄（小时），用于动态调整分类 */
  ageHours?: number;
  /** 用户是否明确标记为敏感 */
  userMarkedSensitive?: boolean;
}

// ── 数据分类结果 ──────────────────────────────────────────────────────────────

/**
 * 分类结果 — DataClassifier.classify() 的返回值。
 */
export interface ClassificationResult {
  /** 分类级别 */
  classification: DataClassification;
  /** 分类原因 */
  reason: string;
  /** 置信度 0.0 ~ 1.0 */
  confidence: number;
  /** 是否有 PII */
  hasPII: boolean;
  /** 建议的处理方式 */
  suggestedHandling: "expose" | "summarize" | "redact" | "block";
}

// ── 权限上下文 ────────────────────────────────────────────────────────────────

/**
 * 权限校验上下文 — 用于 PermissionChecker 决定是否允许暴露。
 */
export interface PermissionContext {
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** 请求的暴露级别 */
  requestedTier: DataClassification;
  /** Feature Flags */
  featureFlags: Record<string, boolean>;
  /** 用户配置的数据偏好 */
  userDataPreferences?: UserDataPreferences;
  /** 目标模型类型 */
  targetModel: "local_7b" | "cloud_72b" | "unknown";
}

/** 用户数据偏好配置 */
export interface UserDataPreferences {
  /** 是否允许云端访问对话历史 */
  allowCloudConversationHistory?: boolean;
  /** 是否允许云端访问记忆 */
  allowCloudMemory?: boolean;
  /** 是否允许云端访问工具结果 */
  allowCloudToolResults?: boolean;
  /** 额外允许暴露的数据类型 */
  extraAllowedTypes?: string[];
  /** 额外禁止暴露的数据类型 */
  extraBlockedTypes?: string[];
}

// ── 权限校验结果 ──────────────────────────────────────────────────────────────

/** 权限校验结果 */
export interface PermissionResult {
  /** 是否允许暴露 */
  allowed: boolean;
  /** 最终允许的分类级别（可能与 requestedTier 不同） */
  tier: DataClassification;
  /** 原因说明 */
  reason?: string;
  /** 降级处理建议 */
  fallbackAction?: "reject" | "summarize" | "redact" | "allow";
  /** 需要执行的脱敏规则 ID 列表 */
  redactionRuleIds?: string[];
  /** 需要摘要的长度上限 */
  summaryMaxLength?: number;
}

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4.2: Data Redaction Engine
// ══════════════════════════════════════════════════════════════════════════════

// ── 脱敏动作类型 ─────────────────────────────────────────────────────────────

/**
 * 脱敏动作类型
 */
export enum RedactionAction {
  /** 用脱敏字符替换（如 138****5678） */
  MASK = "mask",
  /** 哈希处理（不可逆） */
  HASH = "hash",
  /** 截断处理 */
  TRUNCATE = "truncate",
  /** 替换为指定文本 */
  REPLACE = "replace",
  /** 完全移除字段 */
  REMOVE = "remove",
}

// ── 脱敏规则匹配条件 ─────────────────────────────────────────────────────────

/**
 * 脱敏规则匹配条件
 */
export interface RedactionMatchCondition {
  /** JSON path 匹配，如 "user.profile.phone" */
  fieldPath?: string;
  /** 数据类型匹配 */
  dataType?: string;
  /** 正则表达式匹配 */
  regex?: string;
  /** 关键词匹配 */
  keywords?: string[];
}

// ── 脱敏规则配置 ─────────────────────────────────────────────────────────────

/**
 * 脱敏规则配置
 */
export interface RedactionConfig {
  /** 脱敏字符（默认 "*"） */
  maskChar?: string;
  /** 脱敏模式："last4" | "first6_last4" | "email_style" | "full" */
  maskPattern?: "last4" | "first3_last4" | "first6_last4" | "email_style" | "full";
  /** 替换文本（用于 REPLACE 动作） */
  replacement?: string;
  /** 截断最大长度（用于 TRUNCATE 动作） */
  maxLength?: number;
  /** 是否保留原始值的长度信息 */
  preserveLength?: boolean;
}

// ── 脱敏规则 ─────────────────────────────────────────────────────────────────

/**
 * 数据脱敏规则
 */
export interface DataRedactionRule {
  /** 规则唯一 ID */
  id: string;
  /** 规则名称 */
  name: string;
  /** 规则描述 */
  description?: string;
  /** 匹配条件 */
  match: RedactionMatchCondition;
  /** 脱敏动作 */
  action: RedactionAction;
  /** 脱敏配置 */
  config: RedactionConfig;
  /** 优先级（数字越大优先级越高） */
  priority?: number;
  /** 是否启用 */
  enabled?: boolean;
}

// ── 脱敏结果 ─────────────────────────────────────────────────────────────────

/**
 * 脱敏结果
 */
export interface RedactedContent {
  /** 脱敏后的内容 */
  content: string | object;
  /** 原始内容（可选，用于审计） */
  originalContent?: string | object;
  /** 应用的规则 ID 列表 */
  appliedRuleIds: string[];
  /** 脱敏统计 */
  stats: {
    totalMatches: number;
    fieldsRedacted: number;
    charactersMasked: number;
  };
  /** 是否完全脱敏（无法恢复） */
  isFullyRedacted: boolean;
  /** 脱敏原因 */
  reason?: string;
}

// ── 脱敏上下文 ────────────────────────────────────────────────────────────────

/**
 * 脱敏操作上下文
 */
export interface RedactionContext {
  /** Session ID */
  sessionId: string;
  /** User ID */
  userId: string;
  /** 数据类型 */
  dataType: ClassificationContext["dataType"];
  /** 目标暴露级别 */
  targetClassification: DataClassification;
  /** 是否启用审计日志 */
  enableAudit?: boolean;
}

// ── 内置脱敏规则 ─────────────────────────────────────────────────────────────

/**
 * 默认脱敏规则集（8 条内置规则）
 */
export const DEFAULT_REDACTION_RULES: DataRedactionRule[] = [
  {
    id: "phone_cn",
    name: "中国手机号脱敏",
    description: "脱敏 11 位中国手机号，保留前 3 位和后 4 位",
    match: {
      regex: "(?<!\\d)1[3-9]\\d{9}(?!\\d)",
    },
    action: RedactionAction.MASK,
    config: {
      maskPattern: "first3_last4",
      maskChar: "*",
    },
    priority: 100,
    enabled: true,
  },
  {
    id: "email",
    name: "邮箱地址脱敏",
    description: "脱敏邮箱地址，保留域名",
    match: {
      regex: "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}",
    },
    action: RedactionAction.MASK,
    config: {
      maskPattern: "email_style",
      maskChar: "*",
    },
    priority: 90,
    enabled: true,
  },
  {
    id: "id_card_cn",
    name: "中国身份证脱敏",
    description: "脱敏 18 位身份证号，保留前 6 位和后 4 位",
    match: {
      regex: "(?<!\\d)\\d{17}[\\dXx](?!\\d)",
    },
    action: RedactionAction.MASK,
    config: {
      maskPattern: "first6_last4",
      maskChar: "*",
    },
    priority: 110,
    enabled: true,
  },
  {
    id: "api_key",
    name: "API Key 脱敏",
    description: "脱敏各类 API Key、Secret、Token",
    match: {
      regex: "(api[_-]?key|secret[_-]?key|access[_-]?token|bearer|auth)\\s*[:=]\\s*[\\w-]+",
      keywords: ["sk-", "api_", "secret_", "Bearer "],
    },
    action: RedactionAction.REPLACE,
    config: {
      replacement: "***REDACTED***",
    },
    priority: 120,
    enabled: true,
  },
  {
    id: "ip_address",
    name: "IP 地址脱敏",
    description: "脱敏 IPv4 地址",
    match: {
      regex: "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b",
    },
    action: RedactionAction.REPLACE,
    config: {
      replacement: "***.***.***.***",
    },
    priority: 80,
    enabled: true,
  },
  {
    id: "credit_card",
    name: "信用卡号脱敏",
    description: "脱敏信用卡号，保留后 4 位",
    match: {
      regex: "\\b(?:\\d{4}[- ]?){3}\\d{4}\\b",
    },
    action: RedactionAction.MASK,
    config: {
      maskPattern: "last4",
      maskChar: "*",
    },
    priority: 115,
    enabled: true,
  },
  {
    id: "bank_account",
    name: "银行账号脱敏",
    description: "脱敏银行账号，保留后 6 位",
    match: {
      regex: "\\b\\d{16,19}\\b",
    },
    action: RedactionAction.MASK,
    config: {
      maskPattern: "last4",
      maskChar: "*",
    },
    priority: 105,
    enabled: true,
  },
  {
    id: "password",
    name: "密码字段脱敏",
    description: "脱敏密码字段",
    match: {
      fieldPath: "*password*",
      keywords: ["password", "pwd", "passwd", "secret"],
    },
    action: RedactionAction.REPLACE,
    config: {
      replacement: "***HIDDEN***",
    },
    priority: 130,
    enabled: true,
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// Phase 4.3 — SmallModelGuard（小模型守卫）
// ══════════════════════════════════════════════════════════════════════════════

/**
 * 小模型守卫检查结果
 */
export interface GuardResult {
  /** 是否通过 */
  passed: boolean;
  /** 违规类型（如果未通过） */
  violationType?: GuardViolationType;
  /** 违规详情 */
  details?: string;
  /** 被拦截的内容（如果需要审计） */
  blockedContent?: string;
  /** 建议的修复方式 */
  suggestion?: string;
}

/**
 * 守卫动作类型
 */
export enum GuardAction {
  /** 允许通过 */
  ALLOW = "allow",
  /** 拒绝请求 */
  DENY = "deny",
  /** 标记为可疑但允许通过 */
  FLAG = "flag",
  /** 降级到慢模型处理 */
  ESCALATE = "escalate",
  /** 静默拦截（不返回具体原因） */
  SILENT_DENY = "silent_deny",
}

/**
 * 违规类型
 */
export enum GuardViolationType {
  /** 潜在提示注入 */
  PROMPT_INJECTION = "prompt_injection",
  /** 敏感数据暴露 */
  DATA_LEAKAGE = "data_leakage",
  /** 模型拒绝攻击 */
  REFUSAL_ATTACK = "refusal_attack",
  /** 系统 prompt 提取尝试 */
  SYSTEM_PROMPT_EXTRACTION = "system_prompt_extraction",
  /** 恶意指令 */
  MALICIOUS_INSTRUCTION = "malicious_instruction",
  /** 越狱尝试 */
  JAILBREAK = "jailbreak",
  /** 角色扮演攻击 */
  ROLE_PLAYING_ATTACK = "role_playing_attack",
  /** 内容安全违规 */
  CONTENT_VIOLATION = "content_violation",
}

/**
 * 安全规则匹配条件
 */
export interface GuardMatchCondition {
  /** 正则表达式匹配 */
  regex?: string;
  /** 关键词匹配 */
  keywords?: string[];
  /** 模式匹配（预定义） */
  patterns?: GuardPattern[];
}

/**
 * 预定义安全模式
 */
export enum GuardPattern {
  /** URL 链接 */
  URL = "url",
  /** 文件路径 */
  FILE_PATH = "file_path",
  /** 代码块 */
  CODE_BLOCK = "code_block",
  /** Base64 编码 */
  BASE64 = "base64",
  /** JSON 数据 */
  JSON_DATA = "json_data",
  /** SQL 注入特征 */
  SQL_INJECTION = "sql_injection",
  /** 命令注入特征 */
  COMMAND_INJECTION = "command_injection",
}

/**
 * 小模型安全规则
 */
export interface SmallModelGuardRule {
  id: string;
  name: string;
  match: GuardMatchCondition;
  violationType: GuardViolationType;
  action: GuardAction;
  config: GuardRuleConfig;
  priority: number;
  enabled: boolean;
  description?: string;
}

/**
 * 守卫规则配置
 */
export interface GuardRuleConfig {
  customRegex?: string;
  customKeywords?: string[];
  confidenceThreshold?: number;
  enableAIDetection?: boolean;
  auditLog?: boolean;
}

/**
 * 小模型守卫配置
 */
export interface SmallModelGuardConfig {
  rules?: SmallModelGuardRule[];
  defaultEnabled?: boolean;
  defaultAction?: GuardAction;
  enableAIDetection?: boolean;
  confidenceThreshold?: number;
  silentMode?: boolean;
}

/**
 * 守卫检查上下文
 */
export interface GuardContext {
  sessionId: string;
  userId?: string;
  inputType: "user_message" | "tool_result" | "system_context";
  testMode?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * 默认安全规则集
 */
export const DEFAULT_GUARD_RULES: SmallModelGuardRule[] = [
  {
    id: "jailbreak_attempt",
    name: "越狱尝试检测",
    match: {
      patterns: [GuardPattern.CODE_BLOCK],
      keywords: [
        "ignore previous instructions", "ignore all instructions", "ignore all rules",
        "disregard your instructions", "你现在是", "你现在不是", "forget all rules",
        "forget all instructions", "new instructions", "override", "打破规则", "绕过限制", "没有限制",
      ],
    },
    violationType: GuardViolationType.JAILBREAK,
    action: GuardAction.DENY,
    config: { confidenceThreshold: 0.8, auditLog: true },
    priority: 100, enabled: true,
    description: "检测常见的越狱尝试模式",
  },
  {
    id: "prompt_injection",
    name: "提示注入检测",
    match: {
      keywords: [
        "injected prompt", "新的系统提示", "system prompt:", "ignore the above",
        "above instructions", "previous instructions", "你是一个", "你是",
      ],
    },
    violationType: GuardViolationType.PROMPT_INJECTION,
    action: GuardAction.FLAG,
    config: { confidenceThreshold: 0.7, auditLog: true },
    priority: 90, enabled: true,
    description: "检测提示注入攻击",
  },
  {
    id: "system_prompt_extraction",
    name: "系统 Prompt 提取尝试",
    match: {
      keywords: [
        "repeat your system prompt", "show your instructions", "what are your instructions",
        "输出你的系统提示", "显示系统指令", "print system prompt", "reveal your prompt",
      ],
    },
    violationType: GuardViolationType.SYSTEM_PROMPT_EXTRACTION,
    action: GuardAction.DENY,
    config: { auditLog: true },
    priority: 95, enabled: true,
    description: "检测尝试提取系统 prompt 的行为",
  },
  {
    id: "refusal_attack",
    name: "拒绝攻击检测",
    match: {
      keywords: [
        "I cannot comply", "I won't help", "I'm sorry but", "I refuse",
        "as an AI", "ethical concerns", "harmful", "我不能", "我不可以", "抱歉不能",
      ],
    },
    violationType: GuardViolationType.REFUSAL_ATTACK,
    action: GuardAction.FLAG,
    config: { confidenceThreshold: 0.6, auditLog: false },
    priority: 50, enabled: true,
    description: "检测模型拒绝攻击",
  },
  {
    id: "role_playing_attack",
    name: "角色扮演攻击检测",
    match: {
      keywords: [
        "roleplay as", "pretend to be", "act as if", "simulate a",
        "扮演一个", "扮演", "假设你是", "你现在是角色",
      ],
    },
    violationType: GuardViolationType.ROLE_PLAYING_ATTACK,
    action: GuardAction.FLAG,
    config: { confidenceThreshold: 0.7, auditLog: true },
    priority: 95, enabled: true,
    description: "检测角色扮演攻击",
  },
  {
    id: "command_injection",
    name: "命令注入检测",
    match: {
      patterns: [GuardPattern.COMMAND_INJECTION],
      regex: "(rm\\s+-rf|rm\\s+-r|del\\s+/[sqf]|format\\s+[a-z]:|(;|\\||&&)\\s*(rm|del|format|mkdir|chmod|wget|curl|nc|bash|sh)\\b)",
      keywords: ["rm -rf", "rm -r /", "; rm", "| rm", "&& rm", "del /s", "/etc/passwd", "nc attacker"],
    },
    violationType: GuardViolationType.MALICIOUS_INSTRUCTION,
    action: GuardAction.DENY,
    config: { auditLog: true },
    priority: 110, enabled: true,
    description: "检测命令注入攻击",
  },
  {
    id: "sql_injection",
    name: "SQL 注入检测",
    match: {
      patterns: [GuardPattern.SQL_INJECTION],
      regex: "('|(\\'\\'))\\s*(or|and|union|select|insert|delete|drop)\\b",
    },
    violationType: GuardViolationType.MALICIOUS_INSTRUCTION,
    action: GuardAction.DENY,
    config: { auditLog: true },
    priority: 110, enabled: true,
    description: "检测 SQL 注入攻击",
  },
  {
    id: "data_leakage_keywords",
    name: "敏感数据关键词检测",
    match: {
      keywords: ["password", "secret", "api_key", "api-key", "token", "private key", "密钥", "密码", "token"],
    },
    violationType: GuardViolationType.DATA_LEAKAGE,
    action: GuardAction.FLAG,
    config: { confidenceThreshold: 0.8, auditLog: true },
    priority: 70, enabled: true,
    description: "检测可能的敏感数据泄露",
  },
];
