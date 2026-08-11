/**
 * S100P-009/010: Manager Route Message API
 *
 * POST /v1/manager/route-message
 *
 * Accepts a user message in the Manager Loop, routes it to the correct
 * destination (normal conversation, new delegated task, update existing
 * session, or clarification request), and creates the appropriate records.
 *
 * Phase 2: Backend routing only, no UI.
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { AgentSessionRepo } from "../db/repositories/agent-session.js";
import { ManagerMessageRepo } from "../db/repositories/manager-message.js";
import { SessionEventRepo } from "../db/repositories/session-event.js";
import { routeMessage } from "../services/manager-routing/manager-router.js";
import { shapeManagerRouteResponse } from "../services/manager-routing/manager-route-response.js";
import { routeVisibility } from "../services/visibility-routing/visibility-router.js";
import { callModel } from "../models/model-gateway.js";
import { config } from "../config.js";
import type { ActiveSessionSummary } from "../services/manager-routing/manager-routing-types.js";

export const managerRouteRouter = new Hono();

// POST /v1/manager/route-message
managerRouteRouter.post("/route-message", async (c) => {
  const userId = getContextUserId(c)!;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const conversationId = body.conversationId as string | undefined;
  if (!conversationId || typeof conversationId !== "string" || conversationId.trim().length === 0) {
    return c.json({ error: "body.conversationId is required (non-empty string)" }, 400);
  }

  const message = body.message as string | undefined;
  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return c.json({ error: "body.message is required (non-empty string)" }, 400);
  }

  const targetSessionId = (body.targetSessionId as string | undefined) || null;

  try {
    // 1. Fetch active sessions for the user (for reference matching)
    const activeSessionRecords = await AgentSessionRepo.list(userId, {
      limit: 50,
    });
    const activeSessions: ActiveSessionSummary[] = activeSessionRecords
      .filter(s => !["completed", "failed", "cancelled", "rolled_back"].includes(s.status))
      .map(s => ({
        id: s.id,
        title: s.title,
        goal: s.goal,
        status: s.status,
      }));

    // 2. Route the message
    const routing = routeMessage({
      user_id: userId,
      conversation_id: conversationId.trim(),
      message: message.trim(),
      target_session_id: targetSessionId,
      active_sessions: activeSessions,
    });

    // 2a. TRST-4H-III: explicit clarification short-circuit.
    // ask_clarification is deterministic, produced by the hybrid router. It must NOT
    // reach the LLM call, Worker, session creation, or any DB write. Return the shaped
    // API response directly: clarificationRequired=true, assistant managerMessage with
    // non-empty content, no createdSession, no fake task id.
    if (routing.route_type === "ask_clarification") {
      const shaped = shapeManagerRouteResponse(routing, userId);
      return c.json(shaped, 200);
    }

    // 2b. Normal conversation: call LLM for real reply instead of echoing user input
    if (routing.route_type === "normal_conversation") {
      try {
        const reply = await callModel(
          config.fastModel,
          [
            { role: "system", content: "You are a helpful assistant. Answer the user's question concisely in the same language they used." },
            { role: "user", content: message.trim() },
          ],
          "fast"
        );
        routing.manager_message_content = reply;
      } catch (err: any) {
        console.error("[manager-route] LLM call failed for normal_conversation:", err.message);
        routing.manager_message_content = "抱歉，我暂时无法回答这个问题。请尝试输入一个委托任务，如「帮我修登录页UI」。";
      }
    }

    // 3. Execute routing result — create appropriate records

    let createdSession = null;
    let sessionEvent = null;

    // 3a. Create new session if new_delegated_task
    if (routing.created_session) {
      createdSession = await AgentSessionRepo.create({
        user_id: userId,
        title: routing.created_session.title,
        goal: routing.created_session.goal,
        status: routing.created_session.status,
        risk_level: routing.created_session.risk_level,
        delegation_contract: routing.created_session.delegation_contract,
      });
    }

    // 3a2. Execute delegated task via LLM and store results
    let taskResult: string | null = null;
    if (routing.route_type === "new_delegated_task" && createdSession) {
      const sessionId = createdSession.id;
      try {
        // Mark worker as started
        await SessionEventRepo.create({
          session_id: sessionId,
          type: "worker_started",
          summary: `开始执行任务：${message.trim()}`,
          severity: "info",
          visibility: "session_timeline",
        });

        // Call LLM for task execution (delegated_task timeout = 600s for full webpage/code generation)
        taskResult = await callModel(
          config.fastModel,
          [
            {
              role: "system",
              content: "You are a capable AI assistant. Complete the user's request thoroughly. When creating webpages: write a single self-contained HTML file with inline CSS (no separate files). When writing code: output complete working code. Be concise — aim for quality over quantity. Do NOT describe what you would do — output the actual deliverable directly.",
            },
            { role: "user", content: message.trim() },
          ],
          "delegated_task"
        );

        // Store worker completed event: summary = brief, raw_ref = full HTML output
        const isHtmlOutput = taskResult.includes("<!DOCTYPE html>") || taskResult.includes("<html");
        const summaryText = isHtmlOutput
          ? "任务执行完成，已生成 HTML 页面"
          : `任务执行完成：${taskResult.substring(0, 200)}${taskResult.length > 200 ? "..." : ""}`;
        await SessionEventRepo.create({
          session_id: sessionId,
          type: "worker_completed",
          summary: summaryText,
          severity: "info",
          visibility: "session_timeline",
          raw_ref: taskResult,
        });

        // Mark session as completed
        await AgentSessionRepo.setStatus(sessionId, "completed", userId);
        createdSession.status = "completed";

        // Update manager message to show completion
        const taskTitle = routing.created_session?.title ?? createdSession.title ?? "任务";
        routing.manager_message_content = `✅ 任务「${taskTitle}」已完成！点击下方「查看任务 →」查看结果。`;
      } catch (err: any) {
        console.error("[manager-route] Task execution failed:", err.message);

        await SessionEventRepo.create({
          session_id: sessionId,
          type: "worker_failed",
          summary: `任务执行失败：${err.message}`,
          severity: "error",
          visibility: "session_timeline",
        });

        await AgentSessionRepo.setStatus(sessionId, "failed", userId);
        createdSession.status = "failed";

        const taskTitle = routing.created_session?.title ?? createdSession.title ?? "任务";
        routing.manager_message_content = `❌ 任务「${taskTitle}」执行失败：${err.message}`;
      }
    }

    // 3b. Create manager message
    const managerMessage = await ManagerMessageRepo.create({
      user_id: userId,
      conversation_id: conversationId.trim(),
      role: "manager",
      content: routing.manager_message_content,
      related_session_id: routing.target_session_id || createdSession?.id || null,
    });

    // 3c. Create session event if suggested
    if (routing.session_event) {
      const targetSession = routing.target_session_id || createdSession?.id;
      if (targetSession) {
        // Use visibility router to determine the correct visibility
        const visResult = routeVisibility({
          event_type: routing.session_event.type,
          severity: routing.session_event.severity,
        });

        sessionEvent = await SessionEventRepo.create({
          session_id: targetSession,
          type: routing.session_event.type,
          summary: routing.session_event.summary,
          severity: routing.session_event.severity as any,
          visibility: visResult.visibility as any,
        });
      }
    }

    // 4. Return routing result
    return c.json({
      routeType: routing.route_type,
      targetSessionId: routing.target_session_id || createdSession?.id || null,
      clarificationRequired: routing.clarification_required,
      reason: routing.reason,
      managerMessage: {
        id: managerMessage.id,
        content: managerMessage.content,
        role: managerMessage.role,
        relatedSessionId: managerMessage.related_session_id,
        createdAt: managerMessage.created_at,
      },
      createdSession: createdSession ? {
        id: createdSession.id,
        title: createdSession.title,
        status: createdSession.status,
        riskLevel: createdSession.risk_level,
      } : null,
      sessionEvent: sessionEvent ? {
        id: sessionEvent.id,
        type: sessionEvent.type,
        summary: sessionEvent.summary,
        visibility: sessionEvent.visibility,
      } : null,
    }, 200);

  } catch (error: any) {
    console.error("[S100P] Manager route-message error:", error.message);
    return c.json({ error: error.message }, 500);
  }
});
