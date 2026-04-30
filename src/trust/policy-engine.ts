/**
 * TrustPolicy Engine — T3-1
 *
 * 信任策略评估层。所有跨边界数据流动（Fast → Slow Worker / 外部 API）
 * 必须经过 Policy 检查。
 *
 * 设计原则：
 * - 策略不可用时默认 fail-closed（拒绝传输）
 * - 策略本身可热插拔（支持自定义规则注入）
 * - 批量检查一次完成（避免多次往返）
 */

// ── 类型定义 ──────────────────────────────────────────────────────────────────

export type PolicyDecision = "allow" | "deny" | "transform" | "ask_user";

export type DataClassification = "public" | "internal" | "confidential" | "strictly_private";

export type DataType = "user_message" | "memory" | "task_archive" | "command" | "result";

export type DataRecipient = "slow_worker" | "fast_manager" | "user" | "external_api";

/** 单条数据请求的策略评估 */
export interface PolicyCheckRequest {
  data: unknown;
  dataType: DataType;
  recipient: DataRecipient;
  userId: string;
  sessionId: string;
  /** 可选的字段路径，用于 transform 定位 */
  fieldPath?: string[];
  /** 数据来源表/字段名（用于分类查找） */
  source?: string;
}

/** 策略评估结果 */
export interface PolicyCheckResult {
  decision: PolicyDecision;
  /** 当 decision=transform 时，描述需要的转换 */
  transforms?: DataTransform[];
  /** 拒绝原因（当 decision=deny 时） */
  reason?: string;
  /** 需要用户确认的提示（当 decision=ask_user 时） */
  prompt?: string;
  /** 命中的策略规则 ID */
  ruleId?: string;
  /** 数据分类 */
  classification?: DataClassification;
}

/** 数据转换类型 */
export type DataTransform =
  | { type: "redact"; path: string[] }
  | { type: "mask"; path: string[]; maskChar?: string }
  | { type: "generalize"; path: string[] }
  | { type: "replace"; path: string[]; with: unknown };

/** 单条策略规则 */
export interface PolicyRule {
  id: string;
  description: string;
  /** 评估条件，返回 true 表示该规则适用 */
  condition: (req: PolicyCheckRequest, classification: DataClassification) => boolean;
  /** 匹配时要返回的决策 */
  decision: PolicyCheckResult["decision"] | Omit<PolicyCheckResult, "ruleId" | "classification">;
}

/** 策略引擎配置 */
export interface TrustPolicyConfig {
  /** 是否在策略不可用时 fail-open（默认 false = fail-closed） */
  failOpen?: boolean;
  /** 是否记录详细日志 */
  verbose?: boolean;
}

// ── 分类查找表（可扩展）────────────────────────────────────────────────────────

export interface ClassificationMap {
  getClassification(req: PolicyCheckRequest): DataClassification;
}

/** 根据 dataType 推断默认分类 */
export function defaultClassificationForDataType(dataType: DataType): DataClassification {
  switch (dataType) {
    case "user_message": return "confidential";
    case "memory": return "confidential";
    case "task_archive": return "internal";
    case "command": return "internal";
    case "result": return "internal";
  }
}

/** 基于 source 字段路径的分类查找 */
export class SourceBasedClassifier implements ClassificationMap {
  private map: Map<string, DataClassification>;

  constructor(initialMap?: Record<string, DataClassification>) {
    this.map = new Map(Object.entries(initialMap ?? {}));
  }

  addRule(key: string, classification: DataClassification): void {
    this.map.set(key, classification);
  }

  getClassification(req: PolicyCheckRequest): DataClassification {
    if (req.source) {
      const found = this.map.get(req.source);
      if (found) return found;
    }
    return defaultClassificationForDataType(req.dataType);
  }
}

// ── 启发式分类器（未知字段自动推断）───────────────────────────────────────────

/**
 * 自动推断未知字段的分类级别
 * 保守优先：安全边界内推断，不确定时归入较高敏感级别
 */
export function inferClassification(fieldPath: string[], _value: unknown): DataClassification {
  const pathStr = fieldPath.join(".");
  const lower = pathStr.toLowerCase();

  // strictly_private 关键词（高敏感度）
  const strictlyPrivatePatterns = [
    /password|passwd|secret|token|apikey|api_key|private_key|jwt|bearer/i,
    /email|phone|mobile|tel|cell/i,
    /address|ssn|social.?security|national.?id|passport/i,
    /credit.?card|card.?number|cvv|cvc/i,
    /bank.?account|account.?num|routing.?num/i,
  ];
  for (const p of strictlyPrivatePatterns) {
    if (p.test(lower)) return "strictly_private";
  }

  // confidential 关键词（中等敏感度）
  const confidentialPatterns = [
    /preference|prefer|bias|opinion|feeling|personal|private/i,
    /salary|income|earning|revenue|profit/i,
    /medical|health|diagnosis|prescription/i,
    /location|gps|coordinate|latitude|longitude/i,
  ];
  for (const p of confidentialPatterns) {
    if (p.test(lower)) return "confidential";
  }

  // public 关键词（低敏感度）
  const publicPatterns = [
    /^result$|^status$|^type$|^kind$|^action$|^goal$/i,
    /^(id|uuid|created_at|updated_at)$/i,
  ];
  for (const p of publicPatterns) {
    if (p.test(pathStr)) return "public";
  }

  // 保守默认
  return "internal";
}

// ── TrustPolicyEngine ─────────────────────────────────────────────────────────

export class TrustPolicyEngine {
  private rules: PolicyRule[];
  private classifier: ClassificationMap;
  private config: TrustPolicyConfig;

  constructor(
    rules: PolicyRule[] = [],
    classifier?: ClassificationMap,
    config: TrustPolicyConfig = {}
  ) {
    this.rules = rules;
    this.classifier = classifier ?? new SourceBasedClassifier();
    this.config = { failOpen: false, verbose: false, ...config };
  }

  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  clearRules(): void {
    this.rules = [];
  }

  check(request: PolicyCheckRequest): PolicyCheckResult {
    const classification = this.classifier.getClassification(request);

    for (const rule of this.rules) {
      try {
        if (rule.condition(request, classification)) {
          if (this.config.verbose) {
            console.log(`[TrustPolicy] Rule "${rule.id}" matched for ${request.dataType} → ${rule.decision}`);
          }
          // 构建返回结果：先设置默认值，再按规则覆盖
          const result: PolicyCheckResult = {
            decision: typeof rule.decision === "string"
              ? rule.decision
              : rule.decision.decision,
            classification,
            ruleId: rule.id,
          };
          // 补充额外字段（reason / prompt / transforms）
          if (typeof rule.decision !== "string") {
            if (rule.decision.reason !== undefined) result.reason = rule.decision.reason;
            if (rule.decision.prompt !== undefined) result.prompt = rule.decision.prompt;
            if (rule.decision.transforms !== undefined) result.transforms = rule.decision.transforms;
          }
          return result;
        }
      } catch (e) {
        if (this.config.verbose) {
          console.warn(`[TrustPolicy] Rule "${rule.id}" threw during condition check:`, e);
        }
      }
    }

    if (this.config.failOpen) {
      return { decision: "allow", classification };
    }
    return {
      decision: "deny",
      classification,
      reason: `无匹配策略规则，默认拒绝传输（dataType=${request.dataType}, recipient=${request.recipient}）`,
    };
  }

  checkAll(requests: PolicyCheckRequest[]): PolicyCheckResult[] {
    return requests.map((req) => this.check(req));
  }
}