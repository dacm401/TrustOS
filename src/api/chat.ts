import { Hono } from "hono";
import { stream } from "hono/streaming";
import { v4 as uuid } from "uuid";
import type { ChatRequest, ChatResponse, DecisionRecord, ExecutionStepsSummary, FeedbackType, TaskSummary } from "../types/index.js";

const VALID_FEEDBACK_TYPES: readonly FeedbackType[] = [
  "accepted", "regenerated", "edited",
  "thumbs_up", "thumbs_down",
  "follow_up_doubt", "follow_up_thanks",
] as const;
import { logDecision } from "../logging/decision-logger.js";
import { config } from "../config.js";
import { MemoryEntryRepo, TaskRepo, ExecutionResultRepo } from "../db/repositories.js";
import { formatExecutionResultsForPlanner } from "../services/execution-result-formatter.js";
// EL-003: Execution Loop
import { taskPlanner } from "../services/task-planner.js";
import { executionLoop } from "../services/execution-loop.js";
// C3a: unified identity
import { getContextUserId } from "../middleware/identity.js";
// SSE 流式轮询（从 orchestrator.ts 迁移出来）
import { pollArchiveAndYield } from "../services/phase3/sse-poller.js";
import { routeWithManagerDecision } from "../services/llm-native-router.js";
import { TaskArchiveRepo } from "../db/task-archive-repo.js";
// Sprint 63: 跨会话上下文
import { buildCrossSessionContext } from "../services/cross-session-context.js";
// Sprint 65: Permission 对话流 + Operation Auth Matrix
import { handlePermissionResponseMessage } from "../services/permission-manager.js";
// Stream V2: thinking state visualization
import { createThinkingEvent } from "../services/phase3/stream-v2.js";
// Stream V2: 轻量级意图分类器
import { classifyIntent, shouldSkipLLMRouting, generateQuickResponse } from "../services/intent-classifier.js";
// Context Boundary V0: Manager 不能直接消费 raw body.history
import { buildManagerView } from "../services/context/manager-view.js";
import { buildWorkerResultEnvelope } from "../services/context/worker-result-envelope.js";
import { detectArtifactRevisionIntent } from "../services/context/artifact-revision-intent.js";
// Sprint 56: Artifact Revision Routing
import { extractActiveArtifactContext } from "../services/context/active-artifact.js";
// Sprint 60P-H2: pricingKnown 支持
import { calcActualCostEx } from "../config/pricing.js";
// Sprint 61P: Context Packaging — 保留 ContextPackageMode 类型供 V1 使用
import type { ContextPackageMode } from "../services/context/context-package.js";
const chatRouter = new Hono();

chatRouter.post("/chat", async (c) => {
  console.log("[chat] POST /chat received, body size:", c.req.raw.headers.get("content-length") ?? "unknown");
  // UTF-8 fix: use c.req.raw.text() instead of c.req.json()
  // c.req.json() in @hono/node-server can mis-decode UTF-8 body as Latin-1
  const rawBody = await c.req.raw.text();
  let body: ChatRequest;
  try {
    body = JSON.parse(rawBody) as ChatRequest;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }
  const startTime = Date.now();

  // C3a: Priority 1 — middleware context (trusted X-User-Id header)
  // C3a: Priority 2 — dev-only body shim (only when allowDevFallback=true and no context)
  // C3a: read from middleware context via c.get() (not direct property — Hono uses private Map)
  const middlewareUserId = getContextUserId(c);
  // Dev fallback: if middleware couldn't extract (shouldn't happen with correct header)
  const userId = middlewareUserId || body.user_id || "default-user";

  const sessionId = body.session_id || uuid();

  // ── T1: Task Resume v1 (方案 C — 混合) ─────────────────────────────────────
  // Priority 1: explicit task_id in request body
  // Priority 2: find active task by session_id (no terminal status)
  // Priority 3: no resumable task → will create new task below
  let resumedTaskId: string | null = null;
  let resumedTaskSummary: TaskSummary | null = null;

  if (body.task_id) {
    const existingTask = await TaskRepo.getById(body.task_id as string);
    if (!existingTask) {
      return c.json({ error: `Task not found: ${body.task_id}` }, 404);
    }
    if (existingTask.user_id !== userId) {
      return c.json({ error: "Forbidden: task does not belong to this user" }, 403);
    }
    // Only resume if task is not already terminal
    if (!["completed", "failed", "cancelled"].includes(existingTask.status)) {
      resumedTaskId = existingTask.task_id;
      resumedTaskSummary = await TaskRepo.getSummary(existingTask.task_id);
      // Re-activate task status
      await TaskRepo.setStatus(resumedTaskId, "responding").catch((e) => console.warn("[chat] Failed to set task status to responding:", e));
    }
  } else if (body.session_id) {
    // T1: implicit resumption — find most recent active task for this session
    const activeTask = await TaskRepo.findActiveBySession(body.session_id as string, userId);
    if (activeTask) {
      resumedTaskId = activeTask.task_id;
      resumedTaskSummary = await TaskRepo.getSummary(activeTask.task_id);
      await TaskRepo.setStatus(resumedTaskId, "responding").catch((e) => console.warn("[chat] Failed to set task status to responding:", e));
    }
  }

  // 请求级覆盖：前端设置里的 Key / LLM 地址 / 模型优先于环境变量
  const reqApiKey = body.api_key || undefined;
  const reqLlmBaseUrl = body.llm_base_url || undefined;
  const effectiveFastModel = body.fast_model || config.fastModel;
  const effectiveSlowModel = body.slow_model || config.slowModel;

  // ── Sprint 65: 权限响应检测（优先于路由，直接处理授权指令）─────────────────
  // 检测用户消息是否是"允许 xxx" / "拒绝 xxx" 格式，如果是，直接处理授权并返回
  try {
    const permResult = await handlePermissionResponseMessage(body.message ?? "", userId);
    if (permResult.handled) {
      return c.json({
        content: permResult.reply,
        model: "manager",
        routing_layer: "L0",
        decision_type: "direct_answer",
        session_id: sessionId,
        permission_handled: true,
      } satisfies Record<string, unknown>);
    }
  } catch (permErr: any) {
    console.warn("[chat] permission response handling error:", permErr.message);
    // 不阻断主流程，继续正常处理
  }

  try {
    // Sprint 69: 统一 dispatcher — 不再区分 use_llm_native_routing
    // 所有请求走 routeWithManagerDecision，由 stream 标志决定返回格式
    // Sprint 68 发现：use_llm_native_routing 隐式分支导致规则路径和 SSE 路径不对齐
    const useStream = body.stream === true;
    const useLLMNative = body.use_llm_native_routing !== false; // 默认 true

    if (!useLLMNative) {
      return c.json({ error: "Legacy routing path (use_llm_native_routing=false) has been removed. Please remove this flag." }, 400);
    }

    // Sprint 69: 轻量 features 提取（仅用于 logDecision / execute mode）
    // 不再走旧的 analyzeAndRoute，统一由 routeWithManagerDecision 提供
    const { features } = (() => {
      const message = body.message ?? "";
      const safeText = message ?? "";
      const chineseChars = safeText.match(/[\u4e00-\u9fff]/g);
      const language = (chineseChars && chineseChars.length > safeText.length * 0.1) ? "zh" : "en";
      return {
        features: {
          raw_query: message,
          token_count: 0,
          context_token_count: 0,
          conversation_depth: (body.history ?? []).filter((m: any) => m.role === "user").length,
          language,
          intent: "general" as const,
          complexity_score: 50,
          has_code: false,
          has_math: false,
          requires_reasoning: false,
        }
      };
    })();

    // SSE 契约强制：stream=true 必须走 SSE 路径，否则 500
    // 防止 stream=true 但走错了路径导致前端 SSE reader 永远挂起
    if (useStream) {
      // ── SSE 流式分支 ───────────────────────────────────────────────────────────
      let llmNativeResult;
      let activeArtifact: import("../services/context/active-artifact.js").ActiveArtifactContext | undefined;
      try {
        // Stream V2: 轻量级意图预分类（<10ms）
        const intentStart = Date.now();
        const intent = classifyIntent(body.message ?? "");
        const intentTime = Date.now() - intentStart;
        console.log(`[chat] Intent classification: ${intent.category} (${intentTime}ms, confidence: ${intent.confidence})`);

        // 如果是高置信度的简单意图，可以快速返回
        if (shouldSkipLLMRouting(intent)) {
          const quickLang = features.language as "zh" | "en";
          const quickResponse = generateQuickResponse(intent, quickLang);
          if (quickResponse) {
            console.log("[chat] Using quick response for intent:", intent.category);
            c.header("Content-Type", "text/event-stream");
            c.header("Cache-Control", "no-cache");
            c.header("Connection", "keep-alive");
            return stream(c, async (s) => {
              await s.write(`data: ${JSON.stringify({
                type: "thinking",
                thinking_state: "completed",
                stream: quickLang === "zh" ? "✅ 完成" : "✅ Done",
                routing_layer: "L0",
                timestamp: Date.now(),
                meta: { origin: "system", contentKind: "thinking" },
              })}\n\n`);
              await s.write(`data: ${JSON.stringify({
                type: "fast_reply",
                stream: quickResponse,
                routing_layer: "L0",
                meta: { origin: "manager", contentKind: "chat" },
              })}\n\n`);
              await s.write(`data: ${JSON.stringify({
                type: "done",
                stream: quickLang === "zh" ? "已返回答案" : "Answer ready",
                routing_layer: "L0",
                meta: { origin: "system", contentKind: "status" },
              })}\n\n`);
            });
          }
        }

        const cross = await buildCrossSessionContext({
          userId,
          sessionId,
          userMessage: body.message ?? "",
        }).catch((e: any) => {
          console.warn("[chat] cross-session context build failed:", e.message);
          return { crossSessionText: "" };
        });
        const crossSessionContext = cross.crossSessionText || undefined;

        // Context Boundary V0: 构建 Manager Safe View
        const rawHistory = body.history ?? [];
        const managerView = buildManagerView(rawHistory);
        activeArtifact = extractActiveArtifactContext(rawHistory);
        console.log("[context-boundary] manager view", {
          userId,
          sessionId,
          stream: true,
          ...managerView.manifest,
          activeArtifact: Boolean(activeArtifact),
          activeArtifactId: activeArtifact?.artifactId,
          activeArtifactSummaryChars: activeArtifact?.summaryForManager?.length ?? 0,
        });

        llmNativeResult = await routeWithManagerDecision({
          message: body.message ?? "",
          user_id: userId,
          session_id: sessionId,
          turn_id: (body.history ?? []).length,
          history: managerView.messages,
          language: features.language as "zh" | "en",
          reqApiKey,
          reqLlmBaseUrl,
          fastModel: effectiveFastModel,
          slowModel: effectiveSlowModel,
          crossSessionContext,
          activeArtifact,
        });
        console.log("[chat] routeWithManagerDecision done, decision_type:", llmNativeResult?.decision_type, "delegation:", !!llmNativeResult?.delegation);

        // Sprint 61P: ContextPackage V0 trace
        // 在 SSE callback 内部内联构建，避免 try 块内闭包 scope 问题
        // 决策类型在 stream 发起时已确定（delegate_to_slow / direct_answer）
        const cpDecisionType = llmNativeResult.decision_type ?? "direct_answer";
        const cpIsDelegated = Boolean(llmNativeResult.delegation);
        // V0 mode: 根据 decision_type 判断（V1 才用 policyRoute 精确区分）
        let cpMode: "full_delegation" | "bypass_revision" | "bypass_create" = "full_delegation";
        if (cpIsDelegated) {
          // 有 delegation → 取决于是否有 activeArtifact（revision vs new）
          if (activeArtifact) cpMode = "bypass_revision";
          else cpMode = "full_delegation";
        }
        // 构建 trace（V0: 不访问 DB，只用同步数据）
        const cpCommand = (llmNativeResult.decision?.command as any) ?? {
          command_type: "delegate_analysis",
          task_type: "analysis",
          task_brief: "",
          goal: "",
        };
        const cpMetrics = {
          commandGoalLen: cpCommand.goal?.length ?? 0,
          commandBriefLen: cpCommand.task_brief?.length ?? 0,
          commandConstraintsCount: cpCommand.constraints?.length ?? 0,
          archivedArtifactChars: 0,
          confirmedFactsCount: 0,
          evidenceContentCount: 0,
          memorySummaryLen: 0,
          totalContextChars: (cpCommand.goal?.length ?? 0) + (cpCommand.task_brief?.length ?? 0),
        };
        console.log("[context-package] SSE trace", {
          traceId: llmNativeResult.requestSummary?.traceId,
          mode: cpMode,
          isDelegated: cpIsDelegated,
          hasActiveArtifact: Boolean(activeArtifact),
          metrics: cpMetrics,
        });
      } catch (e: any) {
        console.warn("[stream-llm] routeWithManagerDecision failed:", e.message);
        return c.json({ error: "LLM-native routing failed: " + e.message }, 500);
      }

      if (!llmNativeResult) {
        return c.json({ error: "Manager returned null decision" }, 500);
      }

      const lang = features.language as "zh" | "en";
      // Phase 3.0 fix: 使用 archive_id 而非 delegation.task_id，因为 task_archives 表的主键是 archive_id
      // Bug3 fix: direct_answer 时没有真实 archive，不能用随机 UUID（前端会去查 404）
      const archiveId = llmNativeResult.archive_id || llmNativeResult.delegation?.task_id;

      // Sprint 68: Phase 2.0 L2 Rollout
      // Sprint 72: 修复 stream 对齐 bug —— stream=true 时必须走 SSE，不能退化到 JSON
      // 当 isL2Traffic=true 且 L2 未启用或命中 rollout 回退时：
      //   - stream=false：降级到 L0 JSON 响应（符合预期）
      //   - stream=true：跳过此块，走正常 SSE 流程，降级信息通过 routing_layer_degraded 字段传递
      const isL2Traffic = llmNativeResult.routing_layer === "L2" || llmNativeResult.routing_layer === "L3";
      if (isL2Traffic && !useStream && (!config.layer2.enabled || Math.random() > config.layer2.rollout)) {
        const fallback = llmNativeResult.message || (lang === "zh" ? "好的。" : "Got it.");
        c.header("Content-Type", "application/json");
        return c.json({
          routing_layer: "L0",
          routing_layer_degraded: true,
          degraded_from: llmNativeResult.routing_layer,
          message: fallback,
          delegation_log_id: llmNativeResult.delegation_log_id,
        });
      }

      // SSE headers
      c.header("Content-Type", "text/event-stream");
      c.header("Cache-Control", "no-cache");
      c.header("Connection", "keep-alive");
      c.header("X-Accel-Buffering", "no");

      return stream(c, async (s) => {
        console.log("[chat] SSE stream started, writing events...");
        try {
          // Sprint 60P-H2 Evidence Patch: artifactMetaFromSSE 必须在 SSE callback 顶层声明
          // （done 事件在 delegation block 结束后执行，需要访问此变量）
          let artifactMetaFromSSE: Record<string, unknown> | null = null;
          // Stream V2: Thinking 状态 - 分析问题
          await s.write(`data: ${JSON.stringify({
            ...createThinkingEvent("analyzing", lang),
            routing_layer: llmNativeResult.routing_layer,
            meta: { origin: "system", contentKind: "thinking" },
          })}\n\n`);

          // Step 1: Manager 决策
          if (llmNativeResult.message) {
            // Stream V2: Thinking 状态 - 路由决策完成
            await s.write(`data: ${JSON.stringify({
              ...createThinkingEvent("routing", lang),
              routing_layer: llmNativeResult.routing_layer,
              meta: { origin: "system", contentKind: "thinking" },
            })}\n\n`);

            if (llmNativeResult.decision_type === "direct_answer") {
              // 直接回答 → fast_reply（前端直接渲染气泡）
              await s.write(`data: ${JSON.stringify({
                type: "fast_reply",
                stream: llmNativeResult.message,
                routing_layer: llmNativeResult.routing_layer,
                meta: { origin: "manager", contentKind: "chat" },
              })}\n\n`);
            } else {
              // 其他动作 → status（安抚消息，不占气泡）
              await s.write(`data: ${JSON.stringify({
                type: "status",
                stream: llmNativeResult.message,
                routing_layer: llmNativeResult.routing_layer,
                meta: { origin: "system", contentKind: "status" },
              })}\n\n`);
            }
          }

          // Step 2: Clarifying
          if (llmNativeResult.clarifying) {
            await s.write(`data: ${JSON.stringify({
              type: "clarifying",
              stream: llmNativeResult.clarifying.question_text,
              routing_layer: "L0",
              question_text: llmNativeResult.clarifying.question_text,
              options: llmNativeResult.clarifying.options,
              question_id: llmNativeResult.clarifying.question_id,
              meta: { origin: "manager", contentKind: "chat" },
            })}\n\n`);
          }

          // Step 3: delegation
          if (llmNativeResult.delegation) {
            // Stream V2: Thinking 状态 - 任务规划中
            await s.write(`data: ${JSON.stringify({
              ...createThinkingEvent("planning", lang),
              routing_layer: llmNativeResult.routing_layer,
              meta: { origin: "system", contentKind: "thinking" },
            })}\n\n`);

            if (llmNativeResult.archive_id) {
              // 任务存档 → status（进度消息）
              await s.write(`data: ${JSON.stringify({
                type: "status",
                stream: lang === "zh" ? "📋 任务已记录，等待 Worker 执行..." : "Task archived, waiting for Worker...",
                routing_layer: llmNativeResult.routing_layer,
                meta: { origin: "system", contentKind: "status" },
              })}\n\n`);
            } else {
              // delegation 触发但 archive 未创建 → 发 error + done 后立即返回
              await s.write(`data: ${JSON.stringify({
                type: "error",
                stream: llmNativeResult.message ?? "任务无法触发，请重试",
                routing_layer: llmNativeResult.routing_layer,
                meta: { origin: "system", contentKind: "status" },
              })}\n\n`);
              await s.write(`data: ${JSON.stringify({
                type: "done",
                stream: lang === "zh" ? "任务失败" : "Task failed",
                routing_layer: llmNativeResult.routing_layer,
                meta: { origin: "system", contentKind: "status" },
              })}\n\n`);
              return;
            }
            if (llmNativeResult.command_id) {
              // Worker 启动状态
              await s.write(`data: ${JSON.stringify({
                type: "status",
                stream: lang === "zh" ? "🤖 Worker 已启动..." : "Worker started...",
                routing_layer: llmNativeResult.routing_layer,
                meta: { origin: "system", contentKind: "status" },
              })}\n\n`);
            }

            // Sprint 56: 检测 artifact revision intent（后续用于 lineage 追踪）
            const artifactRevisionIntent = Boolean(activeArtifact && llmNativeResult.delegation) && detectArtifactRevisionIntent({
              latestUserMessage: body.message ?? "",
              activeArtifact,
            });

            console.log("[artifact-lineage]", {
              isArtifactRevision: Boolean(artifactRevisionIntent),
              activeArtifactId: activeArtifact?.artifactId,
              activeTaskId: activeArtifact?.taskId,
              newArchiveId: archiveId,
              revisionOfArtifactId: artifactRevisionIntent ? activeArtifact?.artifactId : undefined,
              revisionOfTaskId: artifactRevisionIntent ? activeArtifact?.taskId : undefined,
            });

            console.log("[chat] entering pollArchiveAndYield for task:", archiveId);
            for await (const event of pollArchiveAndYield(archiveId!, lang, llmNativeResult.delegation_log_id, reqApiKey)) {
              // Debug: 每个 SSE event 都打一条，streaming 时太吵，默认注释掉
            // console.log("[chat] pollArchiveAndYield event:", event.type);
              // 统一字段名：content → stream
              const normalizedEvent = {
                ...event,
                routing_layer: event.routing_layer ?? llmNativeResult.routing_layer,
              };
              if (normalizedEvent.content && !normalizedEvent.stream) {
                normalizedEvent.stream = normalizedEvent.content;
                delete normalizedEvent.content;
              }
              // Sprint 58: 判断是否应标记 lineage（仅当 activeArtifact + revision intent + 实际委托）
              const isLineageRevision = Boolean(activeArtifact && artifactRevisionIntent && llmNativeResult?.delegation);

              // Provenance: Worker 产出事件 — 使用 envelope 生成智能 summaryForManager
              if (normalizedEvent.type === "result") {
                const envelope = buildWorkerResultEnvelope({
                  content: normalizedEvent.stream ?? "",
                  taskId: archiveId,
                  artifactId: archiveId,
                  summaryForManager: (event as any).summaryForManager,
                  revisionOfArtifactId: isLineageRevision ? activeArtifact!.artifactId : undefined,
                  revisionOfTaskId: isLineageRevision ? activeArtifact!.taskId : undefined,
                });
                normalizedEvent.meta = {
                  ...envelope.meta,
                  summaryForManager: envelope.brief.summaryForManager,
                };
                // Sprint 60P-H2 Evidence Patch: 捕获 meta 供 done 事件回传
                artifactMetaFromSSE = {
                  origin: envelope.meta.origin,
                  contentKind: envelope.meta.contentKind,
                  taskId: archiveId,
                  artifactId: archiveId,
                  summaryForManager: envelope.brief.summaryForManager,
                  revisionOfArtifactId: envelope.meta.revisionOfArtifactId,
                  revisionOfTaskId: envelope.meta.revisionOfTaskId,
                };
              }
              await s.write(`data: ${JSON.stringify(normalizedEvent)}\n\n`);
            }
          }

          // Sprint 60P-H2: ledger 重建 → 在 done 事件之前完成，以便嵌入 SSE
          // 此时 pollArchiveAndYield 已返回（Worker 已完成，archive.slow_execution 已写入）
          let ledgerPayload: Record<string, unknown> | null = null;
          if (llmNativeResult.requestSummary) {
            const rs = llmNativeResult.requestSummary;
            const rsStartTime = Date.now() - rs.totalLatencyMs;

            let workerInputTokens = 0;
            let workerOutputTokens = 0;
            let workerCostUsd = 0;
            let workerLatencyMs = 0;
            let workerModelName = "unknown";
            if (llmNativeResult.delegation) {
              try {
                const archive = await TaskArchiveRepo.getById(archiveId!);
                if (archive?.slow_execution && typeof archive.slow_execution === "object") {
                  const exec = archive.slow_execution as Record<string, unknown>;
                  workerInputTokens = (exec.tokens_input as number) ?? 0;
                  workerOutputTokens = (exec.tokens_output as number) ?? 0;
                  workerCostUsd = (exec.cost_usd as number) ?? 0;
                  workerLatencyMs = (exec.duration_ms as number) ?? 0;
                  workerModelName = (exec.model_used as string) || config.slowModel;
                }
              } catch (e: any) {
                console.warn("[chat] Failed to refetch archive for ledger rebuild:", e.message);
              }
            }

            // 注入 Worker entry（delegation 路径）
            const hasWorkerData = workerInputTokens > 0 || workerOutputTokens > 0 || workerLatencyMs > 0;
            const workerCostResult = calcActualCostEx(workerModelName, workerInputTokens, workerOutputTokens, workerCostUsd > 0 ? workerCostUsd : undefined);
            const entries = hasWorkerData
              ? [
                  ...rs.entries,
                  {
                    traceId: rs.traceId,
                    modelRole: "worker" as const,
                    modelName: workerModelName,
                    inputTokens: workerInputTokens,
                    outputTokens: workerOutputTokens,
                    estimatedCost: workerCostResult.estimatedCostUsd,
                    pricingKnown: workerCostResult.pricingKnown,
                    pricingSource: workerCostResult.pricingSource,
                    latencyMs: workerLatencyMs,
                    startedAt: rsStartTime,
                    completedAt: Date.now(),
                    usedAuthOverride: false,
                    wasCircuitBroken: false,
                    archiveId: archiveId,
                    taskId: archiveId,
                  },
                ]
              : rs.entries;

            const totalInputTokens = entries.reduce((s, e) => s + e.inputTokens, 0);
            const totalOutputTokens = entries.reduce((s, e) => s + e.outputTokens, 0);
            const estimatedTotalCost = entries.some((e) => e.estimatedCost === null)
              ? null
              : entries.reduce((s, e) => (s as number) + (e.estimatedCost as number), 0 as number | null);
            const managerModelCalls = entries.filter((e) => e.modelRole === "manager").length;
            const slowModelCalls = entries.filter((e) => e.modelRole === "worker").length;
            const workerModelCalls = entries.filter((e) => e.modelRole === "worker_direct_reply").length;
            const managerLatency = entries
              .filter((e) => e.modelRole === "manager")
              .reduce((s, e) => s + e.latencyMs, 0);
            const totalLatencyMs = Date.now() - rsStartTime;
            const routerTaxRatio = totalLatencyMs > 0 ? managerLatency / totalLatencyMs : 0;

            // 重建完整 ledger payload（用于 SSE done 事件 + console 日志）
            ledgerPayload = {
              traceId: rs.traceId,
              policyRoute: rs.policyRoute,
              managerLlmBypassed: rs.managerLlmBypassed,
              bypassReason: rs.bypassReason,
              routingLayer: rs.routingLayer,
              decisionType: rs.decisionType,
              fastPathHeuristic: rs.fastPathHeuristic,
              securityScope: rs.securityScope,
              totalLatencyMs,
              totalModelCalls: entries.length,
              managerCalls: managerModelCalls,
              workerCalls: slowModelCalls,
              totalInputTokens,
              totalOutputTokens,
              estimatedTotalCost,
              routerTaxRatio: Math.round(routerTaxRatio * 10000) / 10000,
              delegationAfterManager: llmNativeResult.delegation,
              entries: entries.map((e) => ({
                modelRole: e.modelRole,
                model: e.modelName,
                inputTokens: e.inputTokens,
                outputTokens: e.outputTokens,
                latencyMs: e.latencyMs,
                estimatedCost: e.estimatedCost,
                pricingKnown: (e as any).pricingKnown ?? true,
                pricingSource: (e as any).pricingSource,
              })),
            };

            // [CALL_LEDGER] console 日志（服务器端，E2E harness 也在监听）
            const entrySummary = (ledgerPayload as any).entries.map((e: any) => ({
              role: e.modelRole,
              model: e.model,
              ms: e.latencyMs,
              inTk: e.inputTokens,
              outTk: e.outputTokens,
              cost: e.estimatedCost != null ? Number(e.estimatedCost).toFixed(6) : null,
              pricingKnown: e.pricingKnown ?? true,
              pricingSource: e.pricingSource,
            }));
            console.log(JSON.stringify({
              msg: "[CALL_LEDGER] Request complete",
              ...(ledgerPayload as any),
              userId: rs.userId,
              sessionId: rs.sessionId,
              estCost: (ledgerPayload as any).estimatedTotalCost != null
                ? Number((ledgerPayload as any).estimatedTotalCost).toFixed(6)
                : null,
              entries: entrySummary,
            }));
          }

          // Done — 嵌入 ledger + artifactMeta + contextPackage 字段（供 harness SSE 解析）
          // Sprint 60P-H2 Evidence Patch: artifactMeta 让下一轮能识别 revision source
          // Sprint 61P: contextPackage 注入 Worker context 的正式边界 trace
          // 内联声明：在 await 之前声明，所有变量都在 SSE callback scope 内
          const doneIsDel = Boolean(llmNativeResult.delegation);
          const doneCmd = (llmNativeResult.decision?.command as any) ?? null;
          const doneMsg = doneIsDel
            ? (lang === "zh" ? "✅ 完成" : "✅ Done")
            : (lang === "zh" ? "已返回答案" : "Answer ready");
          const doneObj: Record<string, unknown> = {
            type: "done",
            stream: doneMsg,
            routing_layer: llmNativeResult.routing_layer,
            task_id: archiveId,
            ledger: ledgerPayload,
            artifactMeta: artifactMetaFromSSE ?? null,
            meta: { origin: "system", contentKind: "status" },
            // Sprint 61P: ContextPackage V0 trace（所有变量在 SSE callback scope 内）
            contextPackage: {
              mode: doneIsDel
                ? (activeArtifact ? "bypass_revision" : "full_delegation")
                : "full_delegation",
              isDelegated: doneIsDel,
              hasActiveArtifact: Boolean(activeArtifact),
              commandGoalLen: doneCmd?.goal?.length ?? 0,
              commandBriefLen: doneCmd?.task_brief?.length ?? 0,
              commandConstraintsLen: doneCmd?.constraints?.join("").length ?? 0,
            },
          };
          await s.write(`data: ${JSON.stringify(doneObj)}\n\n`);
        } catch (sseErr: any) {
          console.error("[chat] SSE stream error:", sseErr.message);
          // 不再尝试写SSE，直接返回500
          // （SSE已失败，客户端已经断开）
        }
      });
    }

    // ── 非 SSE 分支（stream=false / undefined）───────────────────────────────────
    // 走 routeWithManagerDecision，返回 Manager 完整响应（直接回答或澄清）
    let llmNativeResult;
    try {
      const cross = await buildCrossSessionContext({
        userId,
        sessionId,
        userMessage: body.message ?? "",
      }).catch((e: any) => {
        console.warn("[chat] cross-session context build failed:", e.message);
        return { crossSessionText: "" };
      });
      const crossSessionContext = cross.crossSessionText || undefined;

      // Context Boundary V0: 构建 Manager Safe View
      const rawHistory = body.history ?? [];
      const managerView = buildManagerView(rawHistory);
      const activeArtifact = extractActiveArtifactContext(rawHistory);
      console.log("[context-boundary] manager view", {
        userId,
        sessionId,
        stream: false,
        ...managerView.manifest,
        activeArtifact: Boolean(activeArtifact),
        activeArtifactId: activeArtifact?.artifactId,
        activeArtifactSummaryChars: activeArtifact?.summaryForManager?.length ?? 0,
      });

      llmNativeResult = await routeWithManagerDecision({
        message: body.message ?? "",
        user_id: userId,
        session_id: sessionId,
        turn_id: (body.history ?? []).length,
        history: managerView.messages,
        language: features.language as "zh" | "en",
        reqApiKey,
        reqLlmBaseUrl,
        fastModel: effectiveFastModel,
        slowModel: effectiveSlowModel,
        crossSessionContext,
        activeArtifact,
      });
    } catch (e: any) {
      return c.json({ error: "LLM-native routing failed: " + e.message }, 500);
    }

    if (!llmNativeResult) {
      return c.json({ error: "Manager returned null decision" }, 500);
    }

    const archiveId = llmNativeResult.archive_id || llmNativeResult.delegation?.task_id;

    // 记录 decision log
    await logDecision({
      id: uuid(),
      user_id: userId,
      session_id: sessionId,
      timestamp: startTime,
      input_features: features,
      routing: {
        router_version: "llm_native_v1",
        scores: { fast: 1, slow: 0 },
        confidence: llmNativeResult.decision?.confidence ?? 1.0,
        selected_model: config.fastModel,
        selected_role: "fast",
        selection_reason: `llm_native(${llmNativeResult.decision?.decision_type ?? "direct_answer"})`,
        fallback_model: config.slowModel,
        routing_layer: llmNativeResult.routing_layer,
      },
      context: {
        original_tokens: 0,
        compressed_tokens: 0,
        compression_level: "L0",
        compression_ratio: 0,
        memory_items_retrieved: 0,
        final_messages: [],
        compression_details: [],
      },
      execution: {
        model_used: config.fastModel,
        input_tokens: 0,
        output_tokens: 0,
        total_cost_usd: 0,
        latency_ms: Date.now() - startTime,
        did_fallback: false,
        response_text: llmNativeResult.message ?? "",
      },
    }).catch((e) => console.warn("[chat] Failed to log llm-native decision:", e));

    // Sprint 59P: 结构化 Call Ledger 日志输出（非 SSE 分支）
    if (llmNativeResult.requestSummary) {
      const rs = llmNativeResult.requestSummary;
      const logLine = {
        msg: "[CALL_LEDGER] Request complete",
        traceId: rs.traceId,
        userId: rs.userId,
        sessionId: rs.sessionId,
        totalMs: rs.totalLatencyMs,
        modelCalls: rs.totalModelCalls,
        managerCalls: rs.managerModelCalls,
        workerCalls: rs.workerModelCalls,
        slowModelCalls: rs.slowModelCalls,
        totalInTk: rs.totalInputTokens,
        totalOutTk: rs.totalOutputTokens,
        estCost: rs.estimatedTotalCost != null ? (rs.estimatedTotalCost as number).toFixed(6) : null,
        routerTaxRatio: rs.routerTaxRatio.toFixed(3),
        decision: rs.decisionType,
        layer: rs.routingLayer,
        delegated: rs.delegationAfterManager,
        policyRoute: rs.policyRoute,
        managerLlmBypassed: rs.managerLlmBypassed,
        bypassReason: rs.bypassReason,
        security: rs.securityScope,
        fastPath: rs.fastPathHeuristic,
        entries: rs.entries.map((e: any) => ({
          role: e.modelRole,
          model: e.modelName,
          ms: e.latencyMs,
          inTk: e.inputTokens,
          outTk: e.outputTokens,
          cost: e.estimatedCost != null ? (e.estimatedCost as number).toFixed(6) : null,
          pricingKnown: e.pricingKnown ?? true,
          cb: e.wasCircuitBroken,
        })),
      };
      console.log(JSON.stringify(logLine));
    }

    // delegation 触发但 archive 未创建 → 立即返回，不走慢模型等待
    if (llmNativeResult.delegation && !llmNativeResult.archive_id) {
      return c.json({
        content: llmNativeResult.message ?? "任务无法触发，请重试",
        decision_type: llmNativeResult.decision_type ?? "delegate_slow",
        routing_layer: llmNativeResult.routing_layer,
        task_id: undefined,
        error: "archive_create_failed",
      });
    }

    return c.json({
      content: llmNativeResult.message ?? "",
      decision_type: llmNativeResult.decision_type,
      routing_layer: llmNativeResult.routing_layer,
      clarifying: llmNativeResult.clarifying,
      task_id: archiveId,
      delegation: llmNativeResult.delegation
        ? { task_id: llmNativeResult.delegation.task_id, status: "triggered" }
        : undefined,
      meta: { origin: "manager", contentKind: "chat" },
    });
  } catch (error: any) {
    console.error("Chat error:", error);
    return c.json({ error: error.message }, 500);
  }
});

// 旧 /chat-result 端点已废弃（委托结果通过 LLM-Native SSE 实时推送，无需轮询）

chatRouter.post("/feedback", async (c) => {
  let decision_id: string;
  let feedback_type: string;
  let body: Record<string, unknown>;

  try {
    // UTF-8 fix: use c.req.raw.text() instead of c.req.json()
    const rawBody = await c.req.raw.text();
    body = JSON.parse(rawBody) as Record<string, unknown>;
    decision_id = body.decision_id as string;
    feedback_type = body.feedback_type as string;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  if (!decision_id) return c.json({ error: "decision_id is required" }, 400);
  if (!feedback_type) return c.json({ error: "feedback_type is required" }, 400);

  // C3a: Priority 1 — middleware context (trusted X-User-Id header)
  // C3a: Priority 2 — dev-only body shim (only when allowDevFallback=true)
  let user_id = getContextUserId(c);

  // P2-1: Runtime type whitelist validation
  if (!VALID_FEEDBACK_TYPES.includes(feedback_type as FeedbackType)) {
    return c.json({ error: `invalid feedback_type '${feedback_type}'` }, 400);
  }

  // P2-2: Ownership validation
  const { query } = await import("../db/connection.js");
  const decision = await query(`SELECT id, user_id FROM decision_logs WHERE id=$1`, [decision_id]);
  if (decision.rowCount === 0) return c.json({ error: "decision not found" }, 404);
  if (decision.rows[0].user_id !== user_id) {
    return c.json({ error: "forbidden: decision does not belong to this user" }, 403);
  }

  const { recordFeedback } = await import("../features/feedback-collector.js");
  // P3: also write to feedback_events (userId confirmed via ownership check above)
  await recordFeedback(decision_id, feedback_type as FeedbackType, user_id);

  // S2: Fire-and-forget auto_learn on positive-signal feedback
  // Fetches the full decision record and passes it to autoLearnFromDecision
  // so memory_entries gets updated without blocking the feedback response.
  // M2: Also boost recent auto_learn memory relevance_score for this user.
  if (["thumbs_up", "accepted", "follow_up_thanks"].includes(feedback_type)) {
    // M2: Boost recent auto_learn entries (fire-and-forget)
    if (user_id) {
      const { MemoryEntryRepo } = await import("../db/repositories.js");
      MemoryEntryRepo.boostRecentAutoLearn(user_id, 300_000).catch((e) => console.warn("[feedback] boostRecentAutoLearn failed:", e));
    }
    const { autoLearnFromDecision } = await import("../services/memory-store.js");
    const { query: q2 } = await import("../db/connection.js");
    q2(`SELECT intent, selected_model, exec_input_tokens, exec_output_tokens FROM decision_logs WHERE id=$1`, [decision_id])
      .then(async (res) => {
        if (res.rows.length === 0 || !user_id) return;
        const row = res.rows[0];
        // Construct a minimal DecisionRecord sufficient for autoLearnFromDecision
        const minDecision: DecisionRecord = {
          id: decision_id,
          user_id: user_id!,
          session_id: "",
          timestamp: Date.now(),
          input_features: {
            raw_query: "",
            token_count: 0,
            intent: row.intent ?? "unknown",
            complexity_score: 50,
            has_code: false,
            has_math: false,
            requires_reasoning: false,
            conversation_depth: 0,
            context_token_count: 0,
            language: "zh",
          },
          routing: {
            router_version: "v1",
            scores: { fast: 0.5, slow: 0.5 },
            confidence: 0.8,
            selected_model: row.selected_model ?? "",
            selected_role: "fast",
            selection_reason: "",
            fallback_model: "",
          },
          context: {
            original_tokens: 0,
            compressed_tokens: 0,
            compression_level: "L0",
            compression_ratio: 1,
            memory_items_retrieved: 0,
            final_messages: [],
            compression_details: [],
          },
          execution: {
            model_used: row.selected_model ?? "",
            input_tokens: row.exec_input_tokens ?? 0,
            output_tokens: row.exec_output_tokens ?? 0,
            total_cost_usd: 0,
            latency_ms: 0,
            did_fallback: false,
            response_text: "",
          },
          feedback: {
            type: feedback_type as FeedbackType,
            score: 1,
            timestamp: Date.now(),
          },
        };
        await autoLearnFromDecision(user_id!, minDecision);
      })
      .catch((e) => console.warn("[feedback] autoLearnFromDecision failed:", e));
  }

  return c.json({ success: true });
});


export { chatRouter };
