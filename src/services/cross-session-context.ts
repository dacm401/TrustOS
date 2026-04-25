/**
 * CrossSessionContextService — Sprint 63
 *
 * 负责在每次 Manager 路由时，构建跨会话上下文。
 *
 * 数据来源：
 * 1. 当前 session 的活跃任务（task_summaries）
 * 2. 历史 session 的未完成任务（跨 session resume）
 * 3. 历史 session 的主题摘要（session_summaries）
 * 4. Behavioral memory（长期偏好）
 *
 * 输出：填充 PromptRenderContext 的 cross_session_context / current_task / completed_steps / blocked_by 字段
 */

import { TaskRepo, SessionContextRepo } from "../db/repositories.js";
import type { PromptRenderContext } from "./prompt-template-service.js";

/** 构建跨会话上下文文本（供 Manager Prompt 注入） */
export interface CrossSessionContext {
  /** 跨 session 上下文摘要文本（用于 Manager 路由判断） */
  crossSessionText: string;
  /** 当前 session 的活跃任务 */
  currentTask: {
    id: string;
    title: string;
    goal: string | null;
    completedSteps: string[];
    blockedBy: string[];
    nextStep: string | null;
  } | null;
  /** 历史关键事实（来自 session_summaries） */
  recentFacts: string[];
  /** 跨 session 未完成任务数量（用于判断是否需要 Slow 路由） */
  incompleteTaskCount: number;
}

export interface BuildContextOptions {
  userId: string;
  sessionId: string;
  /** 当前用户消息（用于关键词匹配） */
  userMessage: string;
  /** 是否强制构建完整上下文（用于 Manager 路由，非必需） */
  forceFull?: boolean;
}

/**
 * 构建 Manager 路由所需的跨会话上下文。
 *
 * 策略：
 * - 如果当前 session 有活跃任务 → 填充 current_task / completed_steps / blocked_by
 * - 如果有跨 session 未完成任务 → 注入到 cross_session_context
 * - 如果用户消息含关键词（如"继续""之前""接着"）→ 强制拉取完整历史
 * - 如果有相关历史事实 → 注入 key_facts
 *
 * 调用时机：每次 chat 请求 → Manager 路由前
 */
export async function buildCrossSessionContext(
  options: BuildContextOptions
): Promise<CrossSessionContext> {
  const { userId, sessionId, userMessage, forceFull = false } = options;

  const continuationKeywords = ["继续", "接着", "之前", "上次", "keep going", "resume", "continue", "之前", "上文"];
  const isContinuation = forceFull || continuationKeywords.some((kw) =>
    userMessage.toLowerCase().includes(kw.toLowerCase())
  );

  // 1. 当前 session 的活跃任务
  let currentTask: CrossSessionContext["currentTask"] = null;
  try {
    const activeTask = await TaskRepo.findActiveBySession(sessionId, userId);
    if (activeTask) {
      const summary = await TaskRepo.getSummary(activeTask.task_id);
      currentTask = {
        id: activeTask.task_id,
        title: activeTask.title || "未命名任务",
        goal: activeTask.goal || null,
        completedSteps: summary?.completed_steps || [],
        blockedBy: summary?.blocked_by || [],
        nextStep: summary?.next_step || null,
      };
    }
  } catch {
    // 查不到 → 忽略，不阻塞主流程
  }

  // 2. 跨 session 未完成任务（仅在 continuation 或明确需要时拉取）
  let incompleteTaskCount = 0;
  if (isContinuation || currentTask) {
    try {
      const incompleteTasks = await SessionContextRepo.getIncompleteTasks(userId, 5);
      incompleteTaskCount = incompleteTasks.length;
    } catch {
      incompleteTaskCount = 0;
    }
  }

  // 3. 历史关键事实（如果消息含相关关键词则拉取）
  let recentFacts: string[] = [];
  if (isContinuation || currentTask) {
    try {
      recentFacts = await SessionContextRepo.getRecentKeyFacts(userId, 3);
    } catch {
      recentFacts = [];
    }
  }

  // 4. 组装文本
  const lines: string[] = [];

  // 当前任务
  if (currentTask) {
    lines.push(`[当前任务] ${currentTask.title}`);
    if (currentTask.goal) lines.push(`  目标：${currentTask.goal}`);
    if (currentTask.completedSteps.length > 0) {
      lines.push(`  已完成：${currentTask.completedSteps.slice(0, 3).join(" → ")}`);
    }
    if (currentTask.blockedBy.length > 0) {
      lines.push(`  阻塞：${currentTask.blockedBy.join(", ")}`);
    }
    if (currentTask.nextStep) {
      lines.push(`  下一步：${currentTask.nextStep}`);
    }
  }

  // 历史关键事实
  if (recentFacts.length > 0) {
    lines.push(`\n[历史关键事实]`);
    recentFacts.forEach((f) => lines.push(`- ${f}`));
  }

  // 未完成任务提示
  if (incompleteTaskCount > 0 && !currentTask) {
    lines.push(`\n[未完成任务] 你有 ${incompleteTaskCount} 个跨会话未完成任务。`);
    lines.push(`如果用户提到"继续"或"接着"，请优先询问是否要恢复之前的任务。`);
  }

  // 续写场景特别提示
  if (isContinuation && !currentTask) {
    lines.push(`\n[续写检测] 用户可能想继续之前的对话。请检查历史上下文，判断是否需要 slow 模型处理。`);
  }

  return {
    crossSessionText: lines.join("\n"),
    currentTask,
    recentFacts,
    incompleteTaskCount,
  };
}

/**
 * 将 CrossSessionContext 映射到 PromptRenderContext 字段。
 * 供 PromptTemplateService.render() 使用。
 */
export function toPromptRenderContext(
  cross: CrossSessionContext,
  userMessage: string
): Partial<PromptRenderContext> {
  const ctx: Partial<PromptRenderContext> = {
    user_message: userMessage,
    cross_session_context: cross.crossSessionText || undefined,
  };

  if (cross.currentTask) {
    ctx.current_task = cross.currentTask.title || cross.currentTask.goal || "进行中的任务";
    ctx.completed_steps = cross.currentTask.completedSteps;
    ctx.blocked_by = cross.currentTask.blockedBy;
  }

  return ctx;
}
