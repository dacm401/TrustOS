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

  // 更新状态为 running
  await TaskCommandRepo.updateStatus(id, "running", { started_at: new Date() });
  await TaskArchiveRepo.updateState(archive_id, "running" as TaskState);

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
    let content: string;
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const resp = await callModelFull(slowModel, messages);
      content = resp.content;
      inputTokens = resp.input_tokens ?? 0;
      outputTokens = resp.output_tokens ?? 0;
    } catch (modelErr: any) {
      // 写入失败状态
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

    // 写 task_archives.slow_execution（供 pollArchiveAndYield 轮询感知）
    await TaskArchiveRepo.setSlowExecution(archive_id, {
      result: content,
      confidence: 0.85,
      model_used: slowModel,
      tokens_input: inputTokens,
      tokens_output: outputTokens,
      cost_usd: costUsd,
      duration_ms: totalMs,
      completed_at: new Date().toISOString(),
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

    console.log(`[slow-worker] Completed task ${task_id} in ${totalMs}ms, ${inputTokens}+${outputTokens} tokens`);
  } catch (err: any) {
    console.error(`[slow-worker] Failed to execute command ${id}:`, err.message);
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
