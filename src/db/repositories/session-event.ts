/**
 * S100P-004: Session Events Repository
 *
 * session_events table — all Worker/session events scoped to a Session.
 * Every Worker/Event/Approval/Artifact event must be scoped to a Session
 * when it belongs to delegated work.
 */

import { v4 as uuid } from "uuid";
import { query } from "../connection.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type SessionEventVisibility =
  | "silent_audit"
  | "session_timeline"
  | "approval_required"
  | "manager_chat_summary"
  | "trust_report_only"
  | "critical_alert";

export type SessionEventSeverity =
  | "debug"
  | "info"
  | "warn"
  | "error"
  | "critical";

/**
 * Recommended event types per S100P spec:
 *   session.created, contract.generated, worker.started, worker.progress,
 *   action.requested, decision.made, approval.requested, approval.resolved,
 *   artifact.updated, worker.completed, worker.failed,
 *   session.completed, session.failed
 */
export type SessionEventType = string;

export interface SessionEventRecord {
  id: string;
  session_id: string;
  type: SessionEventType;
  summary: string | null;
  severity: SessionEventSeverity;
  visibility: SessionEventVisibility;
  raw_ref: string | null;
  created_at: string;
}

export interface SessionEventInput {
  session_id: string;
  type: SessionEventType;
  summary?: string;
  severity?: SessionEventSeverity;
  visibility?: SessionEventVisibility;
  raw_ref?: string;
}

function mapRow(r: any): SessionEventRecord {
  return {
    id: r.id,
    session_id: r.session_id,
    type: r.type,
    summary: r.summary ?? null,
    severity: r.severity ?? "info",
    visibility: r.visibility ?? "session_timeline",
    raw_ref: r.raw_ref ?? null,
    created_at: new Date(r.created_at).toISOString(),
  };
}

// ── Repo ─────────────────────────────────────────────────────────────────────

export const SessionEventRepo = {
  /** Create a session event */
  async create(input: SessionEventInput): Promise<SessionEventRecord> {
    const id = uuid();
    const result = await query(
      `INSERT INTO session_events
       (id, session_id, type, summary, severity, visibility, raw_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [
        id,
        input.session_id,
        input.type,
        input.summary ?? null,
        input.severity ?? "info",
        input.visibility ?? "session_timeline",
        input.raw_ref ?? null,
      ]
    );
    return mapRow(result.rows[0]);
  },

  /** Batch-create session events (single INSERT) */
  async createBatch(
    events: SessionEventInput[]
  ): Promise<SessionEventRecord[]> {
    if (events.length === 0) return [];

    const placeholders: string[] = [];
    const params: any[] = [];
    let idx = 1;

    for (const evt of events) {
      placeholders.push(
        `($${idx},$${idx + 1},$${idx + 2},$${idx + 3},$${idx + 4},$${idx + 5},$${idx + 6})`
      );
      params.push(
        uuid(),
        evt.session_id,
        evt.type,
        evt.summary ?? null,
        evt.severity ?? "info",
        evt.visibility ?? "session_timeline",
        evt.raw_ref ?? null
      );
      idx += 7;
    }

    const result = await query(
      `INSERT INTO session_events
       (id, session_id, type, summary, severity, visibility, raw_ref)
       VALUES ${placeholders.join(", ")}
       RETURNING *`,
      params
    );
    return result.rows.map(mapRow);
  },

  /** List events for a session, with optional filters */
  async listBySession(
    sessionId: string,
    options?: {
      type?: SessionEventType;
      visibility?: SessionEventVisibility | SessionEventVisibility[];
      severity?: SessionEventSeverity;
      limit?: number;
      offset?: number;
      before?: string;
    }
  ): Promise<SessionEventRecord[]> {
    const limit = Math.min(options?.limit ?? 100, 500);
    const offset = options?.offset ?? 0;

    let sql = `SELECT * FROM session_events WHERE session_id = $1`;
    const params: any[] = [sessionId];
    let idx = 2;

    if (options?.type) {
      sql += ` AND type = $${idx}`;
      params.push(options.type);
      idx++;
    }

    if (options?.visibility) {
      if (Array.isArray(options.visibility)) {
        sql += ` AND visibility = ANY($${idx})`;
        params.push(options.visibility);
      } else {
        sql += ` AND visibility = $${idx}`;
        params.push(options.visibility);
      }
      idx++;
    }

    if (options?.severity) {
      sql += ` AND severity = $${idx}`;
      params.push(options.severity);
      idx++;
    }

    if (options?.before) {
      sql += ` AND created_at < $${idx}`;
      params.push(options.before);
      idx++;
    }

    sql += ` ORDER BY created_at ASC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const result = await query(sql, params);
    return result.rows.map(mapRow);
  },

  /** Get events requiring approval (pending approval_required visibility) */
  async getPendingApprovals(
    sessionId: string
  ): Promise<SessionEventRecord[]> {
    const result = await query(
      `SELECT * FROM session_events
       WHERE session_id = $1 AND visibility = 'approval_required'
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows.map(mapRow);
  },

  /** Get critical alerts for a session */
  async getCriticalAlerts(
    sessionId: string
  ): Promise<SessionEventRecord[]> {
    const result = await query(
      `SELECT * FROM session_events
       WHERE session_id = $1 AND severity = 'critical'
       ORDER BY created_at ASC`,
      [sessionId]
    );
    return result.rows.map(mapRow);
  },

  /** Get latest event for a session */
  async getLatest(sessionId: string): Promise<SessionEventRecord | null> {
    const result = await query(
      `SELECT * FROM session_events
       WHERE session_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [sessionId]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  },

  /** Get a single event by ID */
  async getById(id: string): Promise<SessionEventRecord | null> {
    const result = await query(
      `SELECT * FROM session_events WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) return null;
    return mapRow(result.rows[0]);
  },

  /** Count events for a session, with optional filters */
  async count(
    sessionId: string,
    options?: {
      type?: SessionEventType;
      visibility?: SessionEventVisibility | SessionEventVisibility[];
      severity?: SessionEventSeverity;
    }
  ): Promise<number> {
    let sql = `SELECT COUNT(*)::int AS total FROM session_events WHERE session_id = $1`;
    const params: any[] = [sessionId];
    let idx = 2;

    if (options?.type) {
      sql += ` AND type = $${idx}`;
      params.push(options.type);
      idx++;
    }

    if (options?.visibility) {
      if (Array.isArray(options.visibility)) {
        sql += ` AND visibility = ANY($${idx})`;
        params.push(options.visibility);
      } else {
        sql += ` AND visibility = $${idx}`;
        params.push(options.visibility);
      }
      idx++;
    }

    if (options?.severity) {
      sql += ` AND severity = $${idx}`;
      params.push(options.severity);
      idx++;
    }

    const result = await query(sql, params);
    return result.rows[0]?.total ?? 0;
  },

  /** Alias for count() — count events for a session with optional filters */
  async countBySession(
    sessionId: string,
    options?: {
      type?: SessionEventType;
      visibility?: SessionEventVisibility | SessionEventVisibility[];
      severity?: SessionEventSeverity;
    }
  ): Promise<number> {
    return this.count(sessionId, options);
  },

  /** Get events visible on the timeline (not silent_audit or trust_report_only) */
  async getTimelineEvents(
    sessionId: string,
    limit?: number
  ): Promise<SessionEventRecord[]> {
    const result = await query(
      `SELECT * FROM session_events
       WHERE session_id = $1
         AND visibility NOT IN ('silent_audit', 'trust_report_only')
       ORDER BY created_at ASC
       LIMIT $2`,
      [sessionId, limit ?? 100]
    );
    return result.rows.map(mapRow);
  },
};
