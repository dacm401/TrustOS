/**
 * Sessions API — Sprint 63
 *
 * 提供 Session Summary 的查询和触发生成接口。
 *
 * GET  /v1/sessions/:id/summary   — 获取 session 摘要
 * POST /v1/sessions/:id/summary   — 手动触发生成摘要
 * GET  /v1/sessions/recent         — 获取用户最近的 sessions（含摘要）
 */

import { Hono } from "hono";
import { getContextUserId } from "../middleware/identity.js";
import { callModelFull } from "../models/model-gateway.js";
import { config } from "../config.js";
import { v4 as uuid } from "uuid";

export const sessionsRouter = new Hono();

function errorResp(c: any, message: string, status = 400) {
  return c.json({ error: message }, status);
}

// GET /v1/sessions/:id/summary — 获取 session 摘要
sessionsRouter.get("/:id/summary", async (c) => {
  const userId = getContextUserId(c)!;
  const sessionId = c.req.param("id");

  const { query } = await import("../db/connection.js");
  const result = await query(
    `SELECT ss.*, s.active_topic, s.fast_count, s.slow_count, s.total_requests, s.created_at, s.updated_at
     FROM session_summaries ss
     JOIN sessions s ON s.id = ss.session_id
     WHERE ss.session_id = $1 AND ss.user_id = $2`,
    [sessionId, userId]
  );

  if (result.rows.length === 0) {
    return errorResp(c, `Session summary not found for session: ${sessionId}`, 404);
  }

  const row = result.rows[0];
  return c.json({
    session_id: row.session_id,
    topic: row.topic,
    summary_text: row.summary_text,
    key_facts: row.key_facts,
    decisions_made: row.decisions_made,
    open_questions: row.open_questions,
    preferences: row.preferences,
    turn_count: row.turn_count,
    fast_count: row.fast_count,
    slow_count: row.slow_count,
    model_used: row.model_used,
    generated_by: row.generated_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
});

// POST /v1/sessions/:id/summary — 手动触发生成/更新摘要
sessionsRouter.post("/:id/summary", async (c) => {
  const userId = getContextUserId(c)!;
  const sessionId = c.req.param("id");

  const { query } = await import("../db/connection.js");

  // 1. 验证 session 归属
  const sessionResult = await query(
    `SELECT s.*, ss.summary_text as existing_summary
     FROM sessions s
     LEFT JOIN session_summaries ss ON ss.session_id = s.id
     WHERE s.id = $1 AND s.user_id = $2`,
    [sessionId, userId]
  );

  if (sessionResult.rows.length === 0) {
    return errorResp(c, `Session not found: ${sessionId}`, 404);
  }

  const session = sessionResult.rows[0];

  // 2. 查询该 session 的历史消息（取最近的 20 条作为摘要输入）
  const historyResult = await query(
    `SELECT dl.query_preview, dl.intent, dl.selected_role, dl.model_used,
            dl.feedback_type, dl.feedback_score, dl.created_at
     FROM decision_logs dl
     WHERE dl.session_id = $1 AND dl.user_id = $2
     ORDER BY dl.created_at DESC
     LIMIT 20`,
    [sessionId, userId]
  );

  const historyText = historyResult.rows
    .map((r: any, i: number) =>
      `[${i + 1}] [${r.selected_role}] ${r.query_preview || "(无内容)"} — ${r.intent || "unknown"}`
    )
    .join("\n");

  // 3. 调用 LLM 生成摘要
  let summaryData: {
    topic?: string;
    summary_text?: string;
    key_facts?: string[];
    decisions_made?: string[];
    open_questions?: string[];
  } = {};

  try {
    const prompt = `你是对话摘要专家。请分析以下对话历史，生成结构化摘要。

要求：
- topic：一句话描述会话主题
- summary_text：3-5句话总结对话内容
- key_facts：提取关键事实（1-3条）
- decisions_made：列出已做的决策（0-3条）
- open_questions：列出未解决的问题（0-3条）

对话历史（按时间倒序）：
${historyText}

请严格按以下 JSON 格式输出，只输出 JSON，不要其他内容：
{
  "topic": "...",
  "summary_text": "...",
  "key_facts": ["..."],
  "decisions_made": ["..."],
  "open_questions": ["..."]
}`;

    const resp = await callModelFull(config.compressorModel || "Qwen/Qwen2.5-7B-Instruct", [
      { role: "user", content: prompt },
    ]);

    const jsonMatch = resp.content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      summaryData = JSON.parse(jsonMatch[0]);
    }
  } catch (e: any) {
    console.warn("[sessions] summary generation failed:", e.message);
    summaryData = {
      topic: session.active_topic || "会话",
      summary_text: "摘要生成失败，请稍后重试。",
      key_facts: [],
      decisions_made: [],
      open_questions: [],
    };
  }

  // 4. Upsert session_summaries
  const now = new Date().toISOString();
  await query(
    `INSERT INTO session_summaries
       (id, session_id, user_id, topic, summary_text, key_facts, decisions_made, open_questions, preferences, turn_count, fast_count, slow_count, generated_by, model_used, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (session_id) DO UPDATE SET
       topic = EXCLUDED.topic,
       summary_text = EXCLUDED.summary_text,
       key_facts = EXCLUDED.key_facts,
       decisions_made = EXCLUDED.decisions_made,
       open_questions = EXCLUDED.open_questions,
       version = session_summaries.version + 1,
       updated_at = EXCLUDED.updated_at`,
    [
      uuid(),
      sessionId,
      userId,
      summaryData.topic || session.active_topic || "会话",
      summaryData.summary_text || "",
      summaryData.key_facts || [],
      summaryData.decisions_made || [],
      summaryData.open_questions || [],
      [],
      session.turn_count || historyResult.rows.length,
      session.fast_count || 0,
      session.slow_count || 0,
      "manual",
      config.compressorModel || "Qwen/Qwen2.5-7B-Instruct",
      now,
      now,
    ]
  );

  return c.json({
    session_id: sessionId,
    topic: summaryData.topic || session.active_topic,
    summary_text: summaryData.summary_text,
    key_facts: summaryData.key_facts,
    decisions_made: summaryData.decisions_made,
    open_questions: summaryData.open_questions,
    generated_by: "manual",
    model_used: config.compressorModel || "Qwen/Qwen2.5-7B-Instruct",
  }, 201);
});

// GET /v1/sessions/recent — 获取用户最近的 sessions（含摘要）
sessionsRouter.get("/recent", async (c) => {
  const userId = getContextUserId(c)!;
  const limitRaw = c.req.query("limit");
  const limit = Math.min(parseInt(limitRaw || "10", 10) || 10, 50);

  const { query } = await import("../db/connection.js");
  const result = await query(
    `SELECT s.id as session_id, s.active_topic, s.total_requests, s.fast_count, s.slow_count,
            s.turn_count, s.created_at, s.updated_at,
            ss.summary_text, ss.topic, ss.key_facts
     FROM sessions s
     LEFT JOIN session_summaries ss ON ss.session_id = s.id
     WHERE s.user_id = $1
     ORDER BY s.updated_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  const sessions = result.rows.map((r: any) => ({
    session_id: r.session_id,
    active_topic: r.active_topic,
    total_requests: r.total_requests,
    fast_count: r.fast_count,
    slow_count: r.slow_count,
    turn_count: r.turn_count,
    summary_text: r.summary_text,
    topic: r.topic,
    key_facts: r.key_facts,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }));

  return c.json({ sessions });
});
