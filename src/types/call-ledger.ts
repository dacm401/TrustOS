// Sprint 59P: Latency & Cost Observability — Call Ledger 类型定义
// Sprint 60P-H1: 扩展 modelRole 支持 worker，分拆安全字段按接收方
// 用途：追踪每条请求中所有模型调用的延迟、成本、安全范围
// 纯观测层，不入 DB，仅用于结构化日志输出

/** 一次模型调用的完整记录 */
export interface CallLedgerEntry {

  /** 唯一 trace ID */
  traceId: string;
  /** 模型角色：manager（快模型）/ worker（慢模型）/ worker_direct_reply（快模型降级回复） */
  modelRole: "manager" | "worker" | "worker_direct_reply";
  /** 实际调用的模型名称 */
  modelName: string;
  /** 输入 token 数 */
  inputTokens: number;
  /** 输出 token 数 */
  outputTokens: number;
  /** 估算成本（美元）。若价格表中无该模型，则为 null，严禁显示为 0 */
  estimatedCost: number | null;
  /** 价格是否已知（来自 pricing.ts 配置） */
  pricingKnown: boolean;
  /** 价格来源 */
  pricingSource: "configured" | "fallback" | "unknown";
  /** 调用延迟（毫秒） */
  latencyMs: number;
  /** 调用开始时间戳 */
  startedAt: number;
  /** 调用完成时间戳 */
  completedAt: number;
  /** 是否走 auth override（自定义 Key/BaseUrl） */
  usedAuthOverride: boolean;
  /** 是否熔断降级 */
  wasCircuitBroken: boolean;
  /** 关联的 archive ID（用于 Worker 调用与 request ledger 关联） */
  archiveId?: string;
  /** 关联的 task ID */
  taskId?: string;
}

/** 安全范围标记（按接收方拆分 — Sprint 60P-H1）
 *
 * 关键原则：
 * - ManagerRemote = 远端 Manager LLM（快模型）
 * - WorkerRemote = 远端 Worker LLM（慢模型，SiliconFlow Qwen2.5-72B）
 *
 * 安全含义完全不同：
 * - artifact content 进 ManagerRemote = 红线（Manager 只有 brief，不应看到 artifact 原文）
 * - artifact content 进 WorkerRemote = 允许（Worker revision 需要原 artifact）
 */
export interface SecurityScopeFlags {

  /** ── Artifact Content ─────────────────────────────── */
  /** artifact 原文是否发给了 Manager 远端模型（快模型） */
  sentArtifactContentToManagerRemote: boolean;
  /** artifact 原文是否发给了 Worker 远端模型（慢模型，SiliconFlow Qwen2.5-72B） */
  sentArtifactContentToWorkerRemote: boolean;

  /** ── History ──────────────────────────────────────── */
  /** raw history 是否发给了远端模型（Context Boundary 确保为 false） */
  sentRawHistoryToRemote: boolean;

  /** ── Memory ───────────────────────────────────────── */
  /** memory 是否被检索了（不论是否发给模型） */
  memoryWasRetrieved: boolean;
  /** memory 是否实际进入了 Manager LLM prompt */
  memoryWasSentToManager: boolean;
  /** 是否含敏感标记的 memory 被发出了 */
  sensitiveMemoryWasSent: boolean;

  /** ── Context Bytes ─────────────────────────────────── */
  /** 发送给远端 Manager 的上下文字符数（revision message 等） */
  remoteContextBytesToManager: number;
  /** 发送给远端 Worker 的上下文字符数（revision message 等，不含 artifact content 原文） */
  remoteContextBytesToWorker: number;
  /** artifact content 原文大小（Worker revision 时） */
  artifactContentBytesToWorker: number;
}

/** 兼容旧字段别名（内部使用，逐步迁移） */
export interface LegacySecurityScopeFlags {
  sentArtifactContentToRemote: boolean;
  sentHistoryToRemote: boolean;
  memoryWasRetrieved: boolean;
  memoryWasSentToManager: boolean;
  sensitiveMemoryWasSent: boolean;
  remoteContextBytes: number;
}

/** 启发式快路径判断结果 */
export interface FastPathHeuristic {

  /** 是否可能走快路径（低成本规则而非模型） */
  couldHaveUsedFastPath: boolean;
  /** 判断依据 */
  reason: string;
}

/** Sprint 60P: Execution Policy 路由类型 */
export type ExecutionPolicyRoute =
  | "manager_llm_required"   // 必须调 Manager LLM
  | "direct_artifact_revision" // 明确修订 → 绕过 Manager LLM，直发 Worker
  | "direct_create_artifact"   // 明确新建 artifact → 绕过 Manager LLM，直发 Worker
  | "local_answer_from_meta"   // 元数据足以回答 → 不调任何模型
  | "ask_clarification";       // 意图模糊 → 需要用户澄清

/** Sprint 60P: Execution Policy 决策结果 */
export interface ExecutionPolicyDecision {
  route: ExecutionPolicyRoute;
  reason: string;
  confidence: number;
  managerLlmRequired: boolean;
  workerRequired: boolean;
  securityScope: "local_only" | "minimal_task_contract" | "artifact_source_only" | "redacted_remote";
  costTier: "free" | "cheap" | "medium" | "expensive";
  latencyTier: "instant" | "fast" | "normal" | "slow";
}

/** 单次请求的完整账本汇总 */
export interface RequestLedger {
  /** 请求的 trace ID */
  traceId: string;
  /** 用户 ID */
  userId: string;
  /** Session ID */
  sessionId: string;
  /** 总延迟（毫秒） */
  totalLatencyMs: number;
  /** 总模型调用次数 */
  totalModelCalls: number;
  /** Manager 模型调用次数（快模型） */
  managerModelCalls: number;
  /** Worker 慢模型调用次数（SiliconFlow Qwen2.5-72B） */
  slowModelCalls: number;
  /** Worker direct_reply 模型调用次数（快模型降级） */
  workerModelCalls: number;
  /** 总输入 token 数 */
  totalInputTokens: number;
  /** 总输出 token 数 */
  totalOutputTokens: number;
  /** 估算总成本（美元）。若含未知模型则为 null */
  estimatedTotalCost: number | null;
  /** Router Tax Ratio = Manager LLM 延迟 / 总延迟 */
  routerTaxRatio: number;
  /** Manager 决策后是否委托了 Worker */
  delegationAfterManager: boolean;
  /** 安全范围摘要 */
  securityScope: SecurityScopeFlags;
  /** Sprint 60P: Execution Policy 路由 */
  policyRoute: ExecutionPolicyRoute;
  /** Sprint 62P: Patch-first revision 结果 */
  patch?: {
    attempted: boolean;
    applied: boolean;
    fallbackToFullRewrite: boolean;
    fallbackReason?: string;
    operationCount?: number;
    patchMode?: string;
    sourceBytes: number;
    outputBytes: number;
  };
  /** Sprint 63P: Local Manager 模式 */
  localManager?: {
    enabled: boolean;
    mode: string;
    policyRoute: string;
    managerLlmRequired: boolean;
    managerLlmBypassed: boolean;
    nextAction: string;
    patchFirstEligible?: boolean;
    decisionMs: number;
  };
  /** Sprint 60P: Manager LLM 是否被绕过（Policy Layer 直接决策） */
  managerLlmBypassed: boolean;
  /** Sprint 60P: 绕过原因 */
  bypassReason: string;
  /** 最终决策类型 */
  decisionType: string;
  /** 最终路由层 */
  routingLayer: string;
  /** 详细调用日志 */
  entries: CallLedgerEntry[];
  /** 启发式快路径判断 */
  fastPathHeuristic?: FastPathHeuristic;
}
