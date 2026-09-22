/**
 * RFC-002 Phase 1b: unified work-history / audit query surface.
 *
 * Returns a single chronologically-merged feed across the FIVE audit stores,
 * all scoped to the calling user_id (no cross-user leakage):
 *   - conversation_turns   -> type "message"        (user/assistant original text)
 *   - manager_messages      -> type "manager_prompt" (Manager's processed prompt)
 *   - task_commands         -> type "dispatch"       (brief actually sent to worker)
 *   - task_worker_results   -> type "result"         (worker result)
 *   - task_archives         -> type "archive"        (completed task archive)
 *
 * RFC-002 菜单收敛：原独立「归档」视图数据并入此统一 feed（type=archive），
 * 使工作历史成为真正的超集，归档数据不丢。
 *
 * Supports: full-text search (q, ILIKE), session filter, time range (from/to),
 * pagination (limit/offset). Each item carries drill-down links (session_id /
 * task_id / command_id) so the UI can open the detail view.
 */

import { Hono } from "hono";
import { query } from "../db/connection.js";
import { getContextUserId } from "../middleware/identity.js";

export const workHistoryRouter = new Hono();

type WhType = "message" | "manager_prompt" | "dispatch" | "result" | "archive";

interface WorkHistoryItem {
  type: WhType;
  id: string;
  session_id: string | null;
  task_id: string | null;
  command_id: string | null;
  role?: string;
  content?: string | null;
  payload_json?: unknown;
  result_json?: unknown;
  summary?: string | null;
  status?: string | null;
  created_at: string;
}

/** Build a WHERE clause for the self-contained (session_id-having) tables. */
function whereSelf(
  userId: string,
  sessionId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  q: string | undefined,
  contentCol: string,
  sessionCol = "session_id"
): { sql: string; p: unknown[] } {
  const p: unknown[] = [userId];
  let sql = "user_id = $1";
  if (sessionId) {
    p.push(sessionId);
    sql += ` AND ${sessionCol} = $${p.length}`;
  }
  if (from) {
    p.push(from);
    sql += ` AND created_at >= $${p.length}`;
  }
  if (to) {
    p.push(to);
    sql += ` AND created_at <= $${p.length}`;
  }
  if (q) {
    p.push(`%${q}%`);
    sql += ` AND ${contentCol} ILIKE $${p.length}`;
  }
  return { sql, p };
}

/** Build a WHERE clause for task_commands / task_worker_results (JOIN task_archives for session). */
function whereJoined(
  userId: string,
  sessionId: string | undefined,
  from: string | undefined,
  to: string | undefined,
  q: string | undefined,
  timeCol: string,
  textCol: string,
  tableAlias = "t",
  jsonCol = "payload_json"
): { sql: string; p: unknown[] } {
  const p: unknown[] = [userId];
  let sql = `${tableAlias}.user_id = $1`;
  if (sessionId) {
    p.push(sessionId);
    sql += ` AND a.session_id = $${p.length}`;
  }
  if (from) {
    p.push(from);
    sql += ` AND ${timeCol} >= $${p.length}`;
  }
  if (to) {
    p.push(to);
    sql += ` AND ${timeCol} <= $${p.length}`;
  }
  if (q) {
    p.push(`%${q}%`);
    // search both the structured text column AND the serialized JSON payload
    sql += ` AND (${textCol} ILIKE $${p.length} OR ${tableAlias}.${jsonCol}::text ILIKE $${p.length})`;
  }
  return { sql, p };
}

function iso(d: unknown): string {
  return d ? new Date(d as string | Date).toISOString() : new Date(0).toISOString();
}

workHistoryRouter.get("/", async (c) => {
  const userId = getContextUserId(c);
  const sessionId = c.req.query("session_id") || undefined;
  const from = c.req.query("from") || undefined;
  const to = c.req.query("to") || undefined;
  const q = c.req.query("q") || undefined;
  const limit = Math.min(parseInt(c.req.query("limit") || "50", 10) || 50, 200);
  const offset = parseInt(c.req.query("offset") || "0", 10) || 0;

  // user_id is required for the audit scope; without it there is nothing to return.
  if (!userId) {
    return c.json({ total: 0, limit, offset, items: [] });
  }

  const items: WorkHistoryItem[] = [];

  // 1) conversation_turns (original user/assistant text)
  const w1 = whereSelf(userId, sessionId, from, to, q, "content", "session_id");
  const turns = await query(
    `SELECT id, session_id, role, content, created_at, 'message' AS type
     FROM conversation_turns WHERE ${w1.sql} ORDER BY created_at DESC LIMIT 200`,
    w1.p
  );
  for (const r of turns.rows) {
    items.push({
      type: "message",
      id: r.id,
      session_id: r.session_id,
      task_id: null,
      command_id: null,
      role: r.role,
      content: r.content,
      created_at: iso(r.created_at),
    });
  }

  // 2) manager_messages (Manager's processed prompt) — session lives in related_session_id
  const w2 = whereSelf(userId, sessionId, from, to, q, "content", "related_session_id");
  const mm = await query(
    `SELECT id, related_session_id AS session_id, related_session_id, role, content, created_at, 'manager_prompt' AS type
     FROM manager_messages WHERE ${w2.sql} ORDER BY created_at DESC LIMIT 200`,
    w2.p
  );
  for (const r of mm.rows) {
    items.push({
      type: "manager_prompt",
      id: r.id,
      session_id: r.session_id ?? r.related_session_id,
      task_id: null,
      command_id: null,
      role: r.role,
      content: r.content,
      created_at: iso(r.created_at),
    });
  }

  // 3) task_commands (brief dispatched to worker) — JOIN task_archives for session
  const w3 = whereJoined(userId, sessionId, from, to, q, "t.issued_at", "t.payload_json::text", "t");
  const cmds = await query(
    `SELECT t.id, t.archive_id AS task_id, t.id AS command_id, a.session_id,
            t.payload_json, t.status, t.issued_at AS created_at, 'dispatch' AS type
     FROM task_commands t JOIN task_archives a ON a.id = t.archive_id
     WHERE ${w3.sql} ORDER BY t.issued_at DESC LIMIT 200`,
    w3.p
  );
  for (const r of cmds.rows) {
    items.push({
      type: "dispatch",
      id: r.id,
      session_id: r.session_id,
      task_id: r.task_id,
      command_id: r.command_id,
      payload_json: r.payload_json,
      status: r.status,
      created_at: iso(r.created_at),
    });
  }

  // 4) task_worker_results (worker result) — JOIN task_archives for session
  const w4 = whereJoined(userId, sessionId, from, to, q, "twr.completed_at", "twr.summary", "twr", "result_json");
  const res = await query(
    `SELECT twr.id, twr.task_id, twr.command_id, a.session_id,
            twr.result_json, twr.summary, twr.status, twr.completed_at AS created_at, 'result' AS type
     FROM task_worker_results twr JOIN task_archives a ON a.id = twr.task_id
     WHERE ${w4.sql} ORDER BY twr.completed_at DESC LIMIT 200`,
    w4.p
  );
  for (const r of res.rows) {
    items.push({
      type: "result",
      id: r.id,
      session_id: r.session_id,
      task_id: r.task_id,
      command_id: r.command_id,
      result_json: r.result_json,
      summary: r.summary,
      status: r.status,
      created_at: iso(r.created_at),
    });
  }

  // 5) task_archives (completed task archive) — folded in from the standalone
  //    "归档" view (RFC-002 menu consolidation). type "archive".
  const w5 = whereSelf(
    userId,
    sessionId,
    from,
    to,
    q,
    "COALESCE(command->>'task', user_input)",
    "session_id"
  );
  const arcs = await query(
    `SELECT id, session_id, user_id, status, state,
            COALESCE(command->>'task', user_input) AS content,
            created_at, 'archive' AS type
     FROM task_archives WHERE ${w5.sql} ORDER BY created_at DESC LIMIT 200`,
    w5.p
  );
  for (const r of arcs.rows) {
    items.push({
      type: "archive",
      id: r.id,
      session_id: r.session_id,
      task_id: r.id,
      command_id: null,
      content: r.content,
      status: r.status,
      created_at: iso(r.created_at),
    });
  }

  // Merge + sort by time descending, then paginate.
  items.sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
  const page = items.slice(offset, offset + limit);

  return c.json({ total: items.length, limit, offset, items: page });
});
