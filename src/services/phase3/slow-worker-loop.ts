// Phase 3.0: Slow Worker Loop
// backend/src/services/phase3/slow-worker-loop.ts
//
// 职责：后台轮询 task_commands WHERE command_type LIKE 'delegate%' AND status = 'queued'
//       → 调用 Slow 模型（只读 Archive，不读 history）
//       → 写回 task_archives.slow_execution
//       → 写 task_commands status = completed/failed
//       → 兼容旧 triggerSlowModelBackground：也写 delegation_archive（backward compat）
//
// 使用方式：在 index.ts 中 import { startSlowWorker } from "./services/phase3/slow-worker-loop.js"
//          调用 startSlowWorker() 启动（fire-and-forget）

import { config } from "../../config.js";
import { callModelFull, callOpenAIWithOptions } from "../../models/model-gateway.js";
import { TaskArchiveRepo, TaskCommandRepo, TaskWorkerResultRepo } from "../../db/task-archive-repo.js";
import type { ChatMessage, CommandPayload, TaskState, WorkerResult } from "../../types/index.js";
// Sprint 57: Artifact revision source resolver
import { resolveArtifactRevisionSource } from "../artifacts/artifact-source-resolver.js";
// Sprint 62P: Patch-first Revision
import type { PatchPlan, PatchResult, PatchOperation, PatchLedgerEntry } from "../patch/patch-types.js";
// Sprint 65P: Verifier V0
import { verifyArtifact, verificationToLedgerEntry } from "../verifier/artifact-verifier.js";
import type { VerificationLedgerEntry } from "../verifier/verifier-types.js";
import { applyPatchPlan } from "../patch/patch-applier.js";
// Sprint 75P: Cycle Runtime V0
// Sprint 77P: Human Review Queue V0
import { createHumanReviewRequestFromCycle } from "../human-review/human-review-service.js";
import { runCycle, buildCycleAuditExtract } from "../cycle/cycle-runtime.js";
import type { CycleEventEmitter } from "../cycle/cycle-events.js";
import { buildTaskContract, buildTaskContractAuditExtract } from "../task-contract/task-contract-builder.js";
import type { TaskContractV0, BudgetPolicy, ContractVerificationResult } from "../task-contract/task-contract-types.js";
// S85P: Simple Task Fast Path
import { classifySimpleTask } from "../simple-task-classifier.js";
// S91P: Timeout Policy
import { TASK_SOFT_TIMEOUT_MS, TASK_HARD_TIMEOUT_MS } from "../../types/runtime-trace.js";
// S92P: Terminal state observability
import { buildTerminalSummary } from "../../types/runtime-trace.js";

// 自适应轮询间隔
function getPollInterval(elapsedMs: number): number {
  if (elapsedMs < 30000) return 2000;   // < 30s：频繁
  if (elapsedMs < 120000) return 3000;  // 30s~2min：正常
  return 5000;                           // > 2min：降低频率
}

// 从 task_archives 读取 Archive 上下文
async function loadArchiveContext(archiveId: string): Promise<{
  command: CommandPayload | null;
  userInput: string;
  constraints: string[];
}> {
  const archive = await TaskArchiveRepo.getById(archiveId);
  if (!archive) return { command: null, userInput: "", constraints: [] };

  let command: CommandPayload | null = null;
  try {
    if (archive.command) {
      command = typeof archive.command === "string"
        ? JSON.parse(archive.command)
        : archive.command;
    }
  } catch {}

  return {
    command,
    userInput: archive.user_input ?? "",
    constraints: archive.constraints ?? [],
  };
}

// S90P: Cancellation-aware error class — thrown when task is cancelled mid-execution
class TaskCancelledError extends Error {
  public readonly archiveId: string;
  public readonly taskId: string;
  constructor(archiveId: string, taskId: string) {
    super(`Task ${archiveId} cancelled by user`);
    this.name = "TaskCancelledError";
    this.archiveId = archiveId;
    this.taskId = taskId;
  }
}

/** S90P: Check if task has been cancelled, throw TaskCancelledError if so. */
async function checkCancellation(archiveId: string, taskId: string): Promise<void> {
  if (await TaskArchiveRepo.isCancelled(archiveId)) {
    throw new TaskCancelledError(archiveId, taskId);
  }
}

// S91P: Timeout-aware error class — thrown when task exceeds timeout threshold
class TaskTimedOutError extends Error {
  public readonly archiveId: string;
  public readonly taskId: string;
  public readonly timeoutKind: "soft" | "hard";
  public readonly thresholdMs: number;
  public readonly elapsedMs: number;
  constructor(
    archiveId: string,
    taskId: string,
    timeoutKind: "soft" | "hard",
    thresholdMs: number,
    elapsedMs: number,
  ) {
    super(`Task ${archiveId} timed out (${timeoutKind}, ${elapsedMs}ms / ${thresholdMs}ms)`);
    this.name = "TaskTimedOutError";
    this.archiveId = archiveId;
    this.taskId = taskId;
    this.timeoutKind = timeoutKind;
    this.thresholdMs = thresholdMs;
    this.elapsedMs = elapsedMs;
  }
}

/** S91P: Check if task has exceeded soft or hard timeout, throw TaskTimedOutError if so. */
async function checkTimeout(
  archiveId: string,
  taskId: string,
  startedAt: number,
  softTimeoutMs: number,
  hardTimeoutMs: number,
): Promise<void> {
  const elapsed = Date.now() - startedAt;

  // Check hard timeout first (more severe)
  if (elapsed > hardTimeoutMs) {
    throw new TaskTimedOutError(archiveId, taskId, "hard", hardTimeoutMs, elapsed);
  }

  // Check soft timeout
  if (elapsed > softTimeoutMs) {
    throw new TaskTimedOutError(archiveId, taskId, "soft", softTimeoutMs, elapsed);
  }
}

// 执行单个 delegate 命令
async function executeDelegateCommand(
  commandRecord: {
    id: string;
    task_id: string;
    archive_id: string;
    user_id: string;
    payload_json: CommandPayload;
  }
): Promise<void> {
  const { id, task_id, archive_id, user_id, payload_json } = commandRecord;
  const startTime = Date.now();

  // S90P: Check cancellation before starting — don't execute cancelled tasks
  if (await TaskArchiveRepo.isCancelled(archive_id)) {
    console.log(`[slow-worker] Task ${task_id} already cancelled, skipping`);
    await TaskCommandRepo.updateStatus(id, "cancelled", {
      finished_at: new Date(),
      error_message: "Task cancelled by user before execution",
    });
    return;
  }

  // S91P: Check timeout at entry — skip already-timed-out tasks
  try {
    await checkTimeout(archive_id, task_id, startTime, TASK_SOFT_TIMEOUT_MS, TASK_HARD_TIMEOUT_MS);
  } catch (err: any) {
    if (err instanceof TaskTimedOutError) {
      console.log(`[slow-worker] Task ${task_id} timed out before execution (${err.timeoutKind})`);
      await TaskCommandRepo.updateStatus(id, "timed_out", {
        finished_at: new Date(),
        error_message: `Task timed out (${err.timeoutKind}, ${err.elapsedMs}ms)`,
      });
      await TaskArchiveRepo.markTimedOut(archive_id, {
        timeoutKind: err.timeoutKind,
        thresholdMs: err.thresholdMs,
        elapsedMs: err.elapsedMs,
      });
      return;
    }
    throw err;
  }

  // 更新状态为 running
  await TaskCommandRepo.updateStatus(id, "running", { started_at: new Date() });
  await TaskArchiveRepo.updateState(archive_id, "running" as TaskState);

  // Sprint 60P-H1: 从 archive slow_execution 读取 traceId（用于关联 worker ledger 与 request ledger）
  let traceId: string | undefined;
  try {
    const archive = await TaskArchiveRepo.getById(archive_id);
    if (archive?.slow_execution && typeof archive.slow_execution === "object") {
      traceId = (archive.slow_execution as Record<string, unknown>).traceId as string | undefined;
    }
  } catch (e: any) {
    console.warn(`[slow-worker] Could not read traceId from archive ${archive_id}:`, e.message);
  }

  try {
    // 构造 Worker Prompt：只读 Archive + Command，不读 history
    const taskBrief = payload_json.task_brief ?? "";
    const constraints = payload_json.constraints ?? [];
    const goal = payload_json.goal ?? "";
    const outputFormat = payload_json.required_output?.format ?? "structured_analysis";
    const sections = payload_json.required_output?.sections ?? [];

    // Sprint 57: 检测是否为 artifact revision task
    // 如果是，从 archive 读取原 artifact 内容并注入 prompt
    const isRevisionTask = taskBrief.trim().startsWith("[Artifact Revision Task]") ||
      goal.trim().startsWith("[Artifact Revision Task]");
    console.log(`[slow-worker] task=${task_id?.slice(0,8)||"?"}: isRevisionTask=${isRevisionTask}, taskBriefPrefix="${(taskBrief ?? "").slice(0, 50)}", goalPrefix="${(goal ?? "").slice(0, 50)}"`);

    let originalArtifactContent: string | null = null;
    if (isRevisionTask) {
      try {
        // Sprint 57: 从 task_brief 提取原始 artifactId，不用新的 archive_id
        // task_brief 格式: "[Artifact Revision Task]\nArtifact ID: <orig-id>\n..."
        const origArtifactId = taskBrief.match(/Artifact ID:\s*(\S+)/)?.[1] || archive_id;
        const source = await resolveArtifactRevisionSource({
          artifactId: origArtifactId,
          taskId: task_id,
        });
        if (source && source.source === "archive" && source.content.trim()) {
          originalArtifactContent = source.content;
          console.log(`[slow-worker] Revision task ${task_id}: source=archive, contentLen=${source.content.length}`);
        } else {
          console.warn(`[slow-worker] Revision task ${task_id}: source=unavailable, proceeding with summary only`);
        }
      } catch (e: any) {
        console.warn(`[slow-worker] Revision task ${task_id}: source resolver failed:`, e.message);
      }
    }

    const promptSections: string[] = [
      "【Task Brief — 你需要完成的任务】",
      taskBrief,
    ];
    if (goal) {
      promptSections.push("【Goal】", goal);
    }
    // Sprint 57: 修订任务注入原 artifact content
    if (isRevisionTask) {
      promptSections.push("【This is an artifact revision task.】");
      if (originalArtifactContent) {
        promptSections.push(
          "[Original Artifact Content]",
          "---",
          originalArtifactContent,
          "---"
        );
        promptSections.push(
          "【Instructions】",
          "- Modify the original artifact above according to the User revision instruction.",
          "- Return the FULL revised artifact. Do NOT omit unchanged sections.",
          "- If the instruction is ambiguous, preserve existing functionality.",
        );
      } else {
        promptSections.push(
          "[Original Artifact] (unavailable)",
          "- The original artifact could not be retrieved from archive.",
          "- Base your revision on the Known summary in the Task Brief above.",
          "- Mark the result as degraded if the revision cannot be reliably performed."
        );
      }
    }
    if (constraints.length > 0) {
      promptSections.push("【Constraints】", ...constraints.map((c) => "- " + c));
    }
    if (sections.length > 0) {
      promptSections.push("【Required Sections】", sections.join(", "));
    }
    promptSections.push(
      "【Output Format】" + outputFormat,
      "【重要】只使用 Task Brief 提供的信息，不要读取任何外部历史对话。",
      "如果信息不足，在 summary 中注明 ask_for_more_context。"
    );

    const workerPrompt = promptSections.join("\n");

    const messages: ChatMessage[] = [
      { role: "system", content: workerPrompt },
      { role: "user", content: payload_json.task_brief ?? "" },
    ];

    // 调用 Slow 模型
    const slowModel = config.slowModel;
    let inputTokens = 0;
    let outputTokens = 0;

    // ── Helper: single Worker call（供 cycle runtime 重用）─────────────────────
    async function executeWorkerCall(params: {
      goal: string;
      revisionContext?: string;
      patchApplied?: boolean;
      revisionOfArtifactId?: string;
      activeArtifactId?: string;
    }): Promise<{ content: string; artifactType?: string; patchApplied?: boolean }> {
      const { goal, revisionContext } = params;
      const sections = payload_json.required_output?.sections ?? [];
      const outputFormat = payload_json.required_output?.format ?? "structured_analysis";

      const sections2: string[] = [
        "【Task Brief — 你需要完成的任务】",
        goal,
      ];
      if (isRevisionTask && originalArtifactContent) {
        sections2.push("【This is an artifact revision task.】");
        if (revisionContext) {
          sections2.push("[Original Artifact Content]", "---", revisionContext, "---");
          sections2.push(
            "【Instructions】",
            "- Modify the original artifact above according to the User revision instruction.",
            "- Return the FULL revised artifact. Do NOT omit unchanged sections.",
            "- If the instruction is ambiguous, preserve existing functionality.",
          );
        }
      }
      if (constraints.length > 0) {
        sections2.push("【Constraints】", ...constraints.map((c) => "- " + c));
      }
      if (sections.length > 0) {
        sections2.push("【Required Sections】", sections.join(", "));
      }
      sections2.push(
        "【Output Format】" + outputFormat,
        "【重要】只使用 Task Brief 提供的信息，不要读取任何外部历史对话。",
        "如果信息不足，在 summary 中注明 ask_for_more_context。"
      );

      const msg2: ChatMessage[] = [
        { role: "system", content: sections2.join("\n") },
        { role: "user", content: payload_json.task_brief ?? "" },
      ];

      const resp = await callModelFull(slowModel, msg2, undefined, "worker");
      inputTokens += resp.input_tokens ?? 0;
      outputTokens += resp.output_tokens ?? 0;
      return { content: resp.content ?? "" };
    }

    // ── Sprint 62P: Patch-first Revision V0 ─────────────────────────────────
    // Patch logic 保留在 cycle 外，patch 后 content 作为 cycle 输入
    // （cycle 验证的是 patch 后的最终内容）
    let patchEntry: PatchLedgerEntry | undefined;

    // ── Cycle Runtime V0 ─────────────────────────────────────────────────────
    // 从 archive 读取 qualityRouting/localManager 信号（上游已写入 slow_execution）
    const archive = await TaskArchiveRepo.getById(archive_id);
    let taskContract: TaskContractV0 | null = null;
    try {
      const sr = archive?.slow_execution as Record<string, unknown> | null;
      const qualityRouting = (sr?.qualityRouting as any) ?? null;
      const localManager = (sr?.localManager as any) ?? null;

      // 从 acceptanceCriteria 字段（若有）
      const acceptanceCriteria = (payload_json.required_output?.must_include ?? []) as string[];

      taskContract = buildTaskContract({
        traceId: traceId ?? archive_id,
        userInstruction: archive?.user_input ?? "",
        localManager: localManager as any ?? null,
        qualityRouting: qualityRouting as any ?? null,
        targetArtifactId: archive_id,
        patchFirstAttempted: isRevisionTask,
        acceptanceCriteria,
        constraints: payload_json.constraints ?? [],
      });
    } catch (contractErr: any) {
      console.warn("[cycle] Failed to build TaskContract:", contractErr.message);
    }

      // ── S85P: Simple Task Fast Path (early return) ────────────────────────────
    // If the task is simple + low-risk, execute with a single Worker call,
    // skip cycle runtime entirely, and return early.
    const fastPathClassification = classifySimpleTask({
      taskBrief: taskBrief ?? "",
      goal: goal ?? "",
      constraints: payload_json.constraints ?? [],
      sections: payload_json.required_output?.sections ?? [],
      isRevisionTask,
    });

    if (fastPathClassification.eligible) {
      console.log(JSON.stringify({
        msg: "[S85P_FAST_PATH] Simple task eligible, skipping cycle runtime",
        archiveId: archive_id,
        traceId: traceId ?? null,
        reasonCode: fastPathClassification.reasonCode,
      }));

      try {
        // S90P: Check cancellation before fast path LLM call
        await checkCancellation(archive_id, task_id);
        // S91P: Check timeout before fast path LLM call
        await checkTimeout(archive_id, task_id, startTime, TASK_SOFT_TIMEOUT_MS, TASK_HARD_TIMEOUT_MS);
        const resp = await callModelFull(slowModel, messages, undefined, "worker");
        const fastContent = resp.content;
        const fastInputTokens = resp.input_tokens ?? 0;
        const fastOutputTokens = resp.output_tokens ?? 0;
        const fastTotalMs = Date.now() - startTime;
        const fastCostUsd = estimateCost(fastInputTokens, fastOutputTokens, slowModel);

        // Basic artifact verifier only (no contract verification, no cycle)
        let fastVerificationEntry: VerificationLedgerEntry | null = null;
        try {
          const verifyRes = verifyArtifact({
            traceId: traceId ?? archive_id,
            content: fastContent,
            security: {
              artifactToManager: false,
              rawHistoryToWorker: false,
              rawMemoryToWorker: false,
            },
          });
          fastVerificationEntry = verificationToLedgerEntry(verifyRes);
        } catch {}

        // Write worker result
        const fastWorkerResult: WorkerResult = {
          task_id: task_id,
          worker_type: "slow_analyst",
          status: "completed",
          summary: fastContent.substring(0, 300),
          structured_result: { analysis: fastContent },
          confidence: 0.85,
        };

        await TaskWorkerResultRepo.create({
          task_id: task_id,
          archive_id: archive_id,
          command_id: id,
          user_id: user_id,
          worker_role: "slow_analyst",
          result: fastWorkerResult,
          tokens_input: fastInputTokens,
          tokens_output: fastOutputTokens,
          cost_usd: fastCostUsd,
          started_at: new Date(startTime),
        });

        // Write archive with fastPath metadata
        await TaskArchiveRepo.setSlowExecution(archive_id, {
          result: fastContent,
          confidence: 0.85,
          model_used: slowModel,
          tokens_input: fastInputTokens,
          tokens_output: fastOutputTokens,
          cost_usd: fastCostUsd,
          duration_ms: fastTotalMs,
          completed_at: new Date().toISOString(),
          verification: fastVerificationEntry ?? undefined,
          workerStageTimings: {
            worker_execution_total_ms: fastTotalMs,
          },
            // S85P: Fast path metadata
          // estimatedRoundTripsSaved = 1 means the fast path prevents
          // additional cycle-driven Worker LLM calls (revise/rewrite).
          // It is a conservative estimate — if the normal cycle would not
          // trigger an extra Worker call, actual saved calls could be 0.
          fastPath: {
            eligible: true,
            used: true,
            reasonCode: fastPathClassification.reasonCode,
            skippedStages: ["cycle_runtime", "contract_verification"],
            estimatedRoundTripsSaved: 1,
          },
        });

        await TaskCommandRepo.updateStatus(id, "completed", { finished_at: new Date() });
        try {
          await TaskArchiveRepo.updateStateWithIntegrity(archive_id, "completed");
        } catch (validErr: any) {
          if (validErr.code === "INTEGRITY_VIOLATION") {
            console.warn(`[slow-worker] ⚠️ INTEGRITY_VIOLATION marking ${archive_id} done:`, validErr.message);
            await TaskArchiveRepo.setSlowExecution(archive_id, {
              result: "",
              errors: [`INTEGRITY_VIOLATION: ${validErr.message}`],
              completed_at: new Date().toISOString(),
            });
          }
          throw validErr;
        }

        console.log(JSON.stringify({
          msg: "[CALL_LEDGER_WORKER] Worker model call complete (fast path)",
          traceId: traceId ?? null,
          archiveId: archive_id,
          taskId: task_id,
          model: slowModel,
          modelRole: "worker",
          inputTokens: fastInputTokens,
          outputTokens: fastOutputTokens,
          estimatedCost: fastCostUsd,
          latencyMs: fastTotalMs,
          startedAt: startTime,
          completedAt: Date.now(),
          verification: fastVerificationEntry ?? null,
          fastPath: { eligible: true, used: true },
        }));

        console.log(`[slow-worker] Fast path completed task ${task_id} in ${fastTotalMs}ms`);
        return; // Early return — skip all cycle/legacy logic below
      } catch (err: any) {
        console.error(`[slow-worker] Fast path failed for command ${id}:`, err.message);
        try {
          await TaskCommandRepo.updateStatus(id, "failed", {
            finished_at: new Date(),
            error_message: err.message,
          });
          await TaskArchiveRepo.updateStateWithIntegrity(archive_id, "failed");
          await TaskArchiveRepo.setSlowExecution(archive_id, {
            result: "",
            errors: [err.message],
            completed_at: new Date().toISOString(),
            fastPath: {
              eligible: true,
              used: false,
              reasonCode: fastPathClassification.reasonCode,
              skippedStages: [],
              estimatedRoundTripsSaved: 0,
            },
          });
        } catch {}
        return; // Don't fall through to normal path on fast path failure
      }
    }

    // ── Normal Path: Cycle Runtime or Legacy ────────────────────────────────
    let content: string;
    let contractVerificationEntry: ContractVerificationResult | null = null;
    let cycleAuditEntry: import("../cycle/cycle-runtime.js").CycleAudit | null = null;

    if (taskContract && (taskContract.verificationCriteria?.length ?? 0) > 0) {
      // ── Cycle Runtime 路径 ──────────────────────────────────────────────────
      try {
        // S76P: Cycle events SSE — 写入 task_archive_events via appendCycleEvent
        const cycleResult = await runCycle({
          taskId: archive_id,
          activeArtifactId: undefined,
          revisionOfArtifactId: isRevisionTask ? archive_id : undefined,
          taskContract,
          initialContent: "", // will be filled by first executeWorkerCall
          security: {
            artifactToManager: false,
            rawHistoryToWorker: false,
            rawMemoryToWorker: false,
          },
          // S76P: 将 cycle 中间事件追加到 slow_execution.cycleEvents[]
          onCycleEvent: (async (event: Parameters<CycleEventEmitter>[0]) => {
            try {
              // CycleEvent 只含 metadata (type/cycleIndex/score/recommendedAction/finalStatus)，
              // 无 artifact/history/memory，序列化安全
              const record: Record<string, unknown> = {
                type: event.type,
                taskId: event.taskId,
                cycleIndex: event.cycleIndex,
                timestamp: event.timestamp,
                recommendedAction: event.recommendedAction,
                score: event.score,
                passed: event.passed,
                workerCalled: event.workerCalled,
                finalStatus: event.finalStatus,
                error: event.error,
              };
              await TaskArchiveRepo.appendCycleEvent(archive_id, record);
            } catch (err: unknown) {
              console.warn("[slow-worker] appendCycleEvent failed:", err instanceof Error ? err.message : String(err));
            }
          }) as unknown as CycleEventEmitter,
          executeWorker: async (p) => {
            // S90P: Check cancellation before each worker call in cycle
            await checkCancellation(archive_id, task_id);
            // S91P: Check timeout before each worker call in cycle
            await checkTimeout(archive_id, task_id, startTime, TASK_SOFT_TIMEOUT_MS, TASK_HARD_TIMEOUT_MS);

            let result: { content: string; artifactType?: string; patchApplied?: boolean } = { content: "" };
            let lastError: string | undefined;

            // S89P: Track partial result index in closure for appendPartialResult
            let partialIndex = 0;

            // Patch-first: 尝试 patch，失败则 fallback
            if (isRevisionTask && originalArtifactContent) {
              try {
                // 首次 Worker call → 尝试 patch
                result = await executeWorkerCall({
                  goal: p.goal,
                  revisionContext: p.revisionContext,
                  patchApplied: p.patchApplied,
                  revisionOfArtifactId: p.revisionOfArtifactId,
                  activeArtifactId: p.activeArtifactId,
                });

                // 解析 PatchPlan
                const trimmed = result.content.trim();
                const jsonMatch = trimmed.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
                const jsonStr = jsonMatch ? jsonMatch[1] : (trimmed.startsWith("{") ? trimmed : null);

                if (jsonStr) {
                  const parsed = JSON.parse(jsonStr) as Partial<PatchPlan>;
                  if (parsed && parsed.targetArtifactId && Array.isArray(parsed.operations)) {
                    const patchPlan: PatchPlan = {
                      patchId: parsed.patchId || `patch_${archive_id?.slice(0, 8)}`,
                      traceId: traceId || "unknown",
                      targetArtifactId: parsed.targetArtifactId,
                      revisionInstruction: payload_json.task_brief ?? "",
                      operations: parsed.operations as PatchOperation[],
                      confidence: parsed.confidence ?? 0.5,
                      fallbackToFullRewrite: parsed.fallbackToFullRewrite ?? false,
                    };

                    console.log(`[patch-first] Cycle Worker: PatchPlan ${patchPlan.operations.length} ops, confidence=${patchPlan.confidence}`);

                    if (!patchPlan.fallbackToFullRewrite) {
                      const patchResult: PatchResult = applyPatchPlan(originalArtifactContent, patchPlan);
                      if (patchResult.ok && patchResult.content) {
                        result = {
                          content: patchResult.content,
                          patchApplied: true,
                        };
                        patchEntry = {
                          attempted: true,
                          applied: true,
                          fallbackToFullRewrite: false,
                          operationCount: patchResult.appliedOperations,
                          patchMode: undefined,
                          sourceBytes: patchResult.sourceBytes,
                          outputBytes: patchResult.outputBytes,
                        };
                      } else {
                        patchEntry = {
                          attempted: true,
                          applied: false,
                          fallbackToFullRewrite: true,
                          fallbackReason: patchResult.errors?.[0] ?? "patch_apply_failed",
                          operationCount: patchResult.appliedOperations,
                          sourceBytes: originalArtifactContent.length,
                          outputBytes: result.content.length,
                        };
                      }
                    } else {
                      patchEntry = {
                        attempted: false,
                        applied: false,
                        fallbackToFullRewrite: true,
                        fallbackReason: "worker_indicated_fallback",
                        sourceBytes: originalArtifactContent.length,
                        outputBytes: result.content.length,
                      };
                    }
                  } else {
                    patchEntry = {
                      attempted: true,
                      applied: false,
                      fallbackToFullRewrite: true,
                      fallbackReason: "invalid_patch_plan_structure",
                      sourceBytes: originalArtifactContent.length,
                      outputBytes: result.content.length,
                    };
                  }
                } else {
                  patchEntry = {
                    attempted: true,
                    applied: false,
                    fallbackToFullRewrite: true,
                    fallbackReason: "not_json_output",
                    sourceBytes: originalArtifactContent.length,
                    outputBytes: result.content.length,
                  };
                }
              } catch (e: any) {
                lastError = e?.message ?? "unknown";
                console.warn("[patch-first] Cycle Worker patch error:", lastError);
                patchEntry = {
                  attempted: true,
                  applied: false,
                  fallbackToFullRewrite: true,
                  fallbackReason: `error: ${lastError}`,
                  sourceBytes: originalArtifactContent?.length ?? 0,
                  outputBytes: 0,
                };
                result = { content: "" };
              }
            } else {
              // 非 patch 任务：直接 Worker call
              result = await executeWorkerCall({ goal: p.goal });
            }

            if (!result.content) {
              // Worker call 失败
              const msg = `[Worker call failed] ${lastError ?? "unknown error"}`;
              result = { content: msg };
            }

            // S89P: Append partial result to archive for SSE early display
            // Conservative gates:
            // - Skip if content is empty/whitespace-only
            // - Skip if execution had error (lastError set)
            // - Skip if content contains tool_call indicators (raw tool output, not user-visible)
            // - Truncate before persistence (privacy + DB payload size)
            const trimmedContent = (result.content ?? "").trim();
            const hasToolIndicator = /tool_call|function_call|"tool_calls"/i.test(trimmedContent);
            if (trimmedContent && !lastError && !hasToolIndicator) {
              try {
                const safePreview = trimmedContent.length > 500
                  ? trimmedContent.substring(0, 500) + "…"
                  : trimmedContent;
                await TaskArchiveRepo.appendPartialResult(archive_id, {
                  index: partialIndex++,
                  content: safePreview,
                  timestamp: Date.now(),
                });
              } catch (err: unknown) {
                console.warn("[slow-worker] appendPartialResult failed:", err instanceof Error ? err.message : String(err));
              }
            }

            return result;
          },
          originalGoal: goal,
          originalConstraints: payload_json.constraints ?? [],
        });

        content = cycleResult.finalContent;
        contractVerificationEntry = cycleResult.finalVerification;
        cycleAuditEntry = cycleResult.cycleAudit;

        console.log(JSON.stringify({
          msg: "[CYCLE_RUNTIME] Cycle complete",
          archiveId: archive_id,
          totalCycles: cycleResult.cycleAudit.totalCycles,
          finalStatus: cycleResult.cycleAudit.finalStatus,
          recommendedAction: cycleResult.finalVerification?.recommendedAction,
          passed: cycleResult.finalVerification?.passed,
          score: cycleResult.finalVerification?.score,
          criteriaEvaluated: cycleResult.finalVerification?.criteriaEvaluated,
        }));

        // S77P: human_review 终态 → 创建审核队列记录
        if (cycleResult.finalVerification?.recommendedAction === "human_review") {
          try {
            const saved = await createHumanReviewRequestFromCycle(cycleResult, taskContract);
            console.log(JSON.stringify({
              msg: "[HUMAN_REVIEW] Request created",
              requestId: saved.id,
              taskId: saved.taskId,
              severity: saved.severity,
              reasonCode: saved.reasonCode,
            }));
          } catch (err: any) {
            console.warn("[HUMAN_REVIEW] Failed to create request:", err instanceof Error ? err.message : String(err));
          }
        }
      } catch (cycleErr: any) {
        console.error("[CYCLE_RUNTIME] Cycle error:", cycleErr.message);
        // Cycle 失败时 fallback 到直接 Worker call
        try {
          const resp = await callModelFull(slowModel, messages, undefined, "worker");
          content = resp.content;
          inputTokens = resp.input_tokens ?? 0;
          outputTokens = resp.output_tokens ?? 0;
        } catch (modelErr: any) {
          await TaskCommandRepo.updateStatus(id, "failed", {
            finished_at: new Date(),
            error_message: modelErr.message,
          });
          await TaskArchiveRepo.setSlowExecution(archive_id, {
            result: "",
            errors: [modelErr.message],
            completed_at: new Date().toISOString(),
          });
          throw modelErr;
        }
      }
    } else {
      // ── Legacy 路径（无 criteria / TaskContract 构建失败）───────────────────
      try {
        // S90P: Check cancellation before legacy LLM call
        await checkCancellation(archive_id, task_id);
        // S91P: Check timeout before legacy LLM call
        await checkTimeout(archive_id, task_id, startTime, TASK_SOFT_TIMEOUT_MS, TASK_HARD_TIMEOUT_MS);
        const resp = await callModelFull(slowModel, messages, undefined, "worker");
        content = resp.content;
        inputTokens = resp.input_tokens ?? 0;
        outputTokens = resp.output_tokens ?? 0;
      } catch (modelErr: any) {
        await TaskCommandRepo.updateStatus(id, "failed", {
          finished_at: new Date(),
          error_message: modelErr.message,
        });
        await TaskArchiveRepo.setSlowExecution(archive_id, {
          result: "",
          errors: [modelErr.message],
          completed_at: new Date().toISOString(),
        });
        throw modelErr;
      }

      // Patch logic (legacy)
      if (isRevisionTask && originalArtifactContent) {
        try {
          const trimmed = content.trim();
          const jsonMatch = trimmed.match(/```(?:json)?\s*({[\s\S]*?})\s*```/);
          const jsonStr = jsonMatch ? jsonMatch[1] : (trimmed.startsWith("{") ? trimmed : null);
          if (jsonStr) {
            const parsed = JSON.parse(jsonStr) as Partial<PatchPlan>;
            if (parsed && parsed.targetArtifactId && Array.isArray(parsed.operations)) {
              const patchPlan: PatchPlan = {
                patchId: parsed.patchId || `patch_${task_id?.slice(0, 8)}`,
                traceId: traceId || "unknown",
                targetArtifactId: parsed.targetArtifactId,
                revisionInstruction: payload_json.task_brief ?? "",
                operations: parsed.operations as PatchOperation[],
                confidence: parsed.confidence ?? 0.5,
                fallbackToFullRewrite: parsed.fallbackToFullRewrite ?? false,
              };
              if (!patchPlan.fallbackToFullRewrite) {
                const patchResult: PatchResult = applyPatchPlan(originalArtifactContent, patchPlan);
                if (patchResult.ok && patchResult.content) {
                  content = patchResult.content;
                  patchEntry = {
                    attempted: true,
                    applied: true,
                    fallbackToFullRewrite: false,
                    operationCount: patchResult.appliedOperations,
                    patchMode: undefined,
                    sourceBytes: patchResult.sourceBytes,
                    outputBytes: patchResult.outputBytes,
                  };
                } else {
                  patchEntry = {
                    attempted: true,
                    applied: false,
                    fallbackToFullRewrite: true,
                    fallbackReason: patchResult.errors?.[0] ?? "patch_apply_failed",
                    operationCount: patchResult.appliedOperations,
                    sourceBytes: originalArtifactContent.length,
                    outputBytes: content.length,
                  };
                }
              } else {
                patchEntry = {
                  attempted: false,
                  applied: false,
                  fallbackToFullRewrite: true,
                  fallbackReason: "worker_indicated_fallback",
                  sourceBytes: originalArtifactContent.length,
                  outputBytes: content.length,
                };
              }
            } else {
              patchEntry = {
                attempted: true,
                applied: false,
                fallbackToFullRewrite: true,
                fallbackReason: "invalid_patch_plan_structure",
                sourceBytes: originalArtifactContent.length,
                outputBytes: content.length,
              };
            }
          } else {
            patchEntry = {
              attempted: true,
              applied: false,
              fallbackToFullRewrite: true,
              fallbackReason: "not_json_output",
              sourceBytes: originalArtifactContent.length,
              outputBytes: content.length,
            };
          }
        } catch (e: any) {
          console.log(`[patch-first] Parse error: ${e.message}, using full output as fallback`);
          patchEntry = {
            attempted: true,
            applied: false,
            fallbackToFullRewrite: true,
            fallbackReason: `parse_error: ${e.message}`,
            sourceBytes: originalArtifactContent?.length ?? 0,
            outputBytes: content.length,
          };
        }
      } else {
        console.log(`[patch-first] Not a revision task or no original artifact content; patch not attempted`);
      }
    }

    const totalMs = Date.now() - startTime;
    const costUsd = estimateCost(inputTokens, outputTokens, slowModel);

    // 构造 WorkerResult
    const workerResult: WorkerResult = {
      task_id: task_id,
      worker_type: "slow_analyst",
      status: "completed",
      summary: content.substring(0, 300),
      structured_result: { analysis: content },
      confidence: 0.85,
    };

    // 写 task_worker_results（Phase 3 新表）
    await TaskWorkerResultRepo.create({
      task_id: task_id,
      archive_id: archive_id,
      command_id: id,
      user_id: user_id,
      worker_role: "slow_analyst",
      result: workerResult,
      tokens_input: inputTokens,
      tokens_output: outputTokens,
      cost_usd: costUsd,
      started_at: new Date(startTime),
    });

    // ── Verifier V0 legacy 兜底（无 criteria 时）────────────────────────────────
    let verificationEntry: VerificationLedgerEntry | null = null;
    if (!contractVerificationEntry) {
      try {
        const contentType = (workerResult.structured_result as any)?.contentType
          ?? (patchEntry?.applied ? "code" : undefined);
        const verifyResult = verifyArtifact({
          traceId: traceId ?? archive_id,
          artifactType: contentType,
          content,
          patchApplied: patchEntry?.applied ?? false,
          security: {
            artifactToManager: false,
            rawHistoryToWorker: false,
            rawMemoryToWorker: false,
          },
        });
        verificationEntry = verificationToLedgerEntry(verifyResult);
        console.log(JSON.stringify({
          msg: "[VERIFIER_V0] Artifact verification result",
          traceId: traceId ?? null,
          archiveId: archive_id,
          passed: verifyResult.passed,
          score: verifyResult.score,
          issueCount: verifyResult.issues.length,
          errorCount: verificationEntry.errorCount,
          warningCount: verificationEntry.warningCount,
          decisionMs: verifyResult.decisionMs,
        }));
      } catch (verifyErr: any) {
        console.warn("[VERIFIER_V0] Verifier threw unexpectedly:", verifyErr.message);
      }
    }

    // ── 写 archive slow_execution ──────────────────────────────────────────────
    const auditExtract = taskContract ? buildCycleAuditExtract(cycleAuditEntry!) : null;
    // S84P: Worker stage timings for runtime trace
    const workerStageTimings: Record<string, number> = {
      worker_execution_total_ms: totalMs,
    };
    if (auditExtract) {
      workerStageTimings.cycle_runtime_ms = auditExtract.cycleAuditMs;
    }
    if (verificationEntry) {
      workerStageTimings.verification_ms = (verificationEntry as any).decisionMs ?? 0;
    }
    await TaskArchiveRepo.setSlowExecution(archive_id, {
      result: content,
      confidence: 0.85,
      model_used: slowModel,
      tokens_input: inputTokens,
      tokens_output: outputTokens,
      cost_usd: costUsd,
      duration_ms: totalMs,
      completed_at: new Date().toISOString(),
      // Sprint 65P: Verifier V0 结果（legacy）
      verification: verificationEntry ?? undefined,
      // Sprint 74P: Contract Verification 结果
      contractVerification: contractVerificationEntry ?? undefined,
      // Sprint 75P: Cycle Audit
      cycleAudit: auditExtract ?? undefined,
      // S84P: Worker stage timings for runtime trace
      workerStageTimings,
      // S92P: Terminal state observability for completed state
      terminalSummary: buildTerminalSummary({ status: "completed" }),
    });

    // 更新 task_commands 状态为 completed
    await TaskCommandRepo.updateStatus(id, "completed", { finished_at: new Date() });
    // Phase 3.3: 使用带完整性校验的 updateStateWithIntegrity
    try {
      await TaskArchiveRepo.updateStateWithIntegrity(archive_id, "completed");
    } catch (validErr: any) {
      if (validErr.code === "INTEGRITY_VIOLATION") {
        console.warn(`[slow-worker] ⚠️ INTEGRITY_VIOLATION marking ${archive_id} done:`, validErr.message);
        await TaskArchiveRepo.setSlowExecution(archive_id, {
          result: "",
          errors: [`INTEGRITY_VIOLATION: ${validErr.message}`],
          completed_at: new Date().toISOString(),
        });
      }
      throw validErr;
    }

    // Sprint 60P-H1: 发出 [CALL_LEDGER_WORKER] 日志，供按 traceId 关联 request ledger
    // Sprint 62P: 增加 patch-first 字段
    // Sprint 65P: 增加 verification 字段
    console.log(JSON.stringify({
      msg: "[CALL_LEDGER_WORKER] Worker model call complete",
      traceId: traceId ?? null,
      archiveId: archive_id,
      taskId: task_id,
      model: slowModel,
      modelRole: "worker",
      inputTokens,
      outputTokens,
      estimatedCost: costUsd,
      latencyMs: totalMs,
      startedAt: startTime,
      completedAt: Date.now(),
      patch: patchEntry ?? null,
      verification: verificationEntry ?? null,
    }));

    console.log(`[slow-worker] Completed task ${task_id} in ${totalMs}ms, ${inputTokens}+${outputTokens} tokens`);
  } catch (err: any) {
    // S90P: Handle task cancellation separately from other errors
    if (err instanceof TaskCancelledError) {
      console.log(`[slow-worker] Task ${err.archiveId} cancelled, marking as cancelled`);
      try {
        // S92P: Build terminal summary for cancelled state
        const cancelledSummary = buildTerminalSummary({ status: "cancelled" });
        await TaskCommandRepo.updateStatus(id, "cancelled", {
          finished_at: new Date(),
          error_message: "Task cancelled by user",
        });
        await TaskArchiveRepo.updateState(archive_id, "cancelled" as TaskState);
        await TaskArchiveRepo.setSlowExecution(archive_id, {
          cancelledAt: new Date().toISOString(),
          cancelReason: "Task cancelled by user",
          completed_at: new Date().toISOString(),
          terminalSummary: cancelledSummary,
        });
      } catch (updateErr: any) {
        console.error("[slow-worker] Failed to mark cancellation:", updateErr.message);
      }
      return;
    }

    // S91P: Handle task timeout separately from other errors
    if (err instanceof TaskTimedOutError) {
      console.log(`[slow-worker] Task ${err.archiveId} timed out (${err.timeoutKind}), marking as timed_out`);
      try {
        // S92P: Build terminal summary for timed_out state
        const timedOutSummary = buildTerminalSummary({
          status: "timed_out",
          execution: {
            timeoutKind: err.timeoutKind,
            elapsedMs: err.elapsedMs,
            thresholdMs: err.thresholdMs,
          },
        });
        await TaskCommandRepo.updateStatus(id, "timed_out", {
          finished_at: new Date(),
          error_message: `Task timed out (${err.timeoutKind}, ${err.elapsedMs}ms / ${err.thresholdMs}ms)`,
        });
        await TaskArchiveRepo.markTimedOut(archive_id, {
          timeoutKind: err.timeoutKind,
          thresholdMs: err.thresholdMs,
          elapsedMs: err.elapsedMs,
        });
        await TaskArchiveRepo.setSlowExecution(archive_id, {
          terminalSummary: timedOutSummary,
        });
      } catch (updateErr: any) {
        console.error("[slow-worker] Failed to mark timeout:", updateErr.message);
      }
      return;
    }

    console.error(`[slow-worker] Failed to execute command ${id}:`, err.message);
    try {
      // S92P: Build terminal summary for failed state
      const failedSummary = buildTerminalSummary({ status: "failed", errorMessage: err.message });
      await TaskCommandRepo.updateStatus(id, "failed", {
        finished_at: new Date(),
        error_message: err.message,
      });
      await TaskArchiveRepo.updateStateWithIntegrity(archive_id, "failed");
      await TaskArchiveRepo.setSlowExecution(archive_id, {
        result: "",
        errors: [err.message],
        completed_at: new Date().toISOString(),
        terminalSummary: failedSummary,
      });
    } catch (updateErr: any) {
      console.error("[slow-worker] Failed to update status:", updateErr.message);
    }
  }
}

// 粗估费用
function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  // Qwen2.5-72B-Instruct pricing (approximate)
  const priceIn = 0.001;
  const priceOut = 0.002;
  return (inputTokens / 1000) * priceIn + (outputTokens / 1000) * priceOut;
}

// 轮询循环
async function pollLoop(): Promise<void> {
  const POLL_INTERVAL_MS = 1000;

  while (!workerStopped) {
    try {
      // 查询 queued 的 delegate 命令（排除 execute_plan）
      const { query } = await import("../../db/connection.js");
      const result = await query(
        `SELECT tc.*, ta.user_input
         FROM task_commands tc
         JOIN task_archives ta ON ta.id = tc.archive_id
         WHERE tc.status = 'queued'
           AND tc.command_type NOT LIKE 'execute%'
         ORDER BY
           CASE tc.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
           tc.issued_at ASC
         LIMIT 5`
      );

      if (result.rows.length > 0) {
        console.log(`[slow-worker] Found ${result.rows.length} queued command(s)`);
      }

      for (const row of result.rows) {
        if (workerStopped) break;
        // 反序列化 payload_json
        const payload_json: CommandPayload = typeof row.payload_json === "string"
          ? JSON.parse(row.payload_json)
          : row.payload_json;

        await executeDelegateCommand({
          id: row.id,
          task_id: row.task_id,
          archive_id: row.archive_id,
          user_id: row.user_id,
          payload_json,
        });
      }
    } catch (err: any) {
      console.error("[slow-worker] Poll error:", err.message);
    }

    if (!workerStopped) {
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log("[slow-worker] Stopped.");
}

// ── 启动入口 ───────────────────────────────────────────────────────────────

let workerStarted = false;
let workerStopped = false;

export function startSlowWorker(): void {
  if (workerStarted) {
    console.log("[slow-worker] Already started, skipping");
    return;
  }
  workerStarted = true;
  workerStopped = false;

  console.log("[slow-worker] Starting slow worker loop...");
  pollLoop().catch((err) => {
    console.error("[slow-worker] Unhandled error in poll loop:", err.message);
    workerStarted = false;
  });
}

/** 优雅停止 worker，供 index.ts 关机时调用 */
export function stopSlowWorker(): void {
  if (!workerStarted) return;
  workerStopped = true;
  console.log("[slow-worker] Stopping...");
}

// 让 sleep 可中断
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // 如果设置了 stopped flag，提前 resolve
    const check = setInterval(() => {
      if (workerStopped) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}
