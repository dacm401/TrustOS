/**
 * TRST-4C: Durable Event Index (SQLite-backed)
 *
 * Architecture:
 *   JSONL (.trustos/events.jsonl) = Source of truth (append-only, tamper-evident)
 *   SQLite (.trustos/events.db)   = Fast query index (rebuildable from JSONL)
 *
 * The index stores event metadata (not raw content) for O(1) lookups,
 * pagination, filtering, and session grouping.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import type { TrstEventEnvelope } from "./event-envelope.js";

export interface EventIndexRow {
  event_id: string;
  event_type: string;
  timestamp: string;
  session_id: string;
  agent_id: string | null;
  status: string;
  request_mode: string | null;
  model: string | null;
  token_count: number | null;
  input_hash: string | null;
  output_hash: string | null;
  error_code: string | null;
  /** MWT-3B1: nullable task correlation ID (null = unassigned / pre-task). */
  task_id: string | null;
}

export interface PaginatedEvents {
  events: EventIndexRow[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

export interface SessionSummary {
  session_id: string;
  first_event: string;
  last_event: string;
  event_count: number;
  model_calls: number;
  tool_calls: number;
  total_tokens: number;
  agents: string[];
}

export class EventIndex {
  private db: Database.Database;
  private jsonlPath: string;
  private dbPath: string;

  constructor(jsonlPath: string) {
    this.jsonlPath = jsonlPath;
    this.dbPath = path.join(path.dirname(jsonlPath), "events.db");
    this.db = new Database(this.dbPath);

    // Performance pragmas
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("cache_size = -8000"); // 8MB cache

    this.createTables();
  }

  private createTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        event_type TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        agent_id TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        request_mode TEXT,
        model TEXT,
        token_count INTEGER,
        input_hash TEXT,
        output_hash TEXT,
        error_code TEXT,
        cost_estimate REAL
      );

      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_events_agent ON events(agent_id);
      CREATE INDEX IF NOT EXISTS idx_events_request_mode ON events(request_mode);

      -- Track which JSONL events we've already indexed
      CREATE TABLE IF NOT EXISTS index_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    // MWT-3B1: Migration — add nullable task_id column (idempotent).
    // Existing rows default to NULL. Safe to re-run on dev mismatch.
    this.db.exec(`ALTER TABLE events ADD COLUMN task_id TEXT;`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_events_task_id ON events(task_id);`);

    // Track last synced line number
    this.db
      .prepare("INSERT OR IGNORE INTO index_meta (key, value) VALUES (?, ?)")
      .run("last_synced_line", "0");
  }

  /**
   * Sync SQLite index from JSONL. Called on startup.
   * Only reads new events since last sync.
   */
  syncFromJsonl(): number {
    if (!fs.existsSync(this.jsonlPath)) return 0;

    const lastSync = parseInt(
      (this.db.prepare("SELECT value FROM index_meta WHERE key = ?").get("last_synced_line") as { value?: string } | undefined)?.value || "0",
      10
    );

    const content = fs.readFileSync(this.jsonlPath, "utf-8");
    const lines = content.trim().split("\n").filter(Boolean);
    if (lines.length <= lastSync) return 0;

    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO events
        (event_id, event_type, timestamp, session_id, agent_id, status,
         request_mode, model, token_count, input_hash, output_hash, error_code, cost_estimate, task_id)
      VALUES
        (@event_id, @event_type, @timestamp, @session_id, @agent_id, @status,
         @request_mode, @model, @token_count, @input_hash, @output_hash, @error_code, @cost_estimate, @task_id)
    `);

    const insertMany = this.db.transaction((newLines: string[]) => {
      for (const line of newLines) {
        try {
          const e: TrstEventEnvelope = JSON.parse(line);
          insert.run({
            event_id: e.event_id,
            event_type: e.event_type,
            timestamp: e.timestamp,
            session_id: e.session_id,
            agent_id: e.agent_id || null,
            status: e.status || "success",
            request_mode: e.request_mode || null,
            model: e.model || null,
            token_count: e.token_count || null,
            input_hash: e.input_hash || null,
            output_hash: e.output_hash || null,
            error_code: e.error_code || null,
            cost_estimate: e.cost_estimate || null,
            task_id: e.task_id ?? null,
          });
        } catch {
          // Skip malformed lines
        }
      }
    });

    const newLines = lines.slice(lastSync);
    insertMany(newLines);

    // Update sync position
    this.db
      .prepare("UPDATE index_meta SET value = ? WHERE key = ?")
      .run(lines.length.toString(), "last_synced_line");

    return newLines.length;
  }

  /**
   * Append a single event to the index (called at runtime after JSONL write).
   */
  appendEvent(e: TrstEventEnvelope): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO events
        (event_id, event_type, timestamp, session_id, agent_id, status,
         request_mode, model, token_count, input_hash, output_hash, error_code, cost_estimate, task_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        e.event_id, e.event_type, e.timestamp, e.session_id, e.agent_id || null,
        e.status || "success", e.request_mode || null, e.model || null,
        e.token_count || null, e.input_hash || null, e.output_hash || null,
        e.error_code || null, e.cost_estimate || null, e.task_id ?? null
      );

    // Update line count for sync position
    const currentLine = parseInt(
      (this.db.prepare("SELECT value FROM index_meta WHERE key = ?").get("last_synced_line") as { value?: string } | undefined)?.value || "0",
      10
    );
    this.db.prepare("UPDATE index_meta SET value = ? WHERE key = ?").run(
      (currentLine + 1).toString(), "last_synced_line"
    );
  }

  /**
   * Paginated events query with optional filters.
   */
  queryEvents(options: {
    page?: number;
    limit?: number;
    session_id?: string;
    event_type?: string;
    agent_id?: string;
    from?: string; // ISO timestamp
    to?: string;
    request_mode?: string;
    /**
     * MWT-3B1 task correlation filter (PM R4/R6).
     * - string value → exact match WHERE task_id = ?
     * - null literal (explicit) → WHERE task_id IS NULL (unassigned)
     * - undefined → no task_id filter (existing behavior unchanged)
     */
    task_id?: string | null;
  } = {}): PaginatedEvents {
    const { page = 1, limit = 50, session_id, event_type, agent_id, from, to, request_mode, task_id } = options;

    const conditions: string[] = [];
    const params: any[] = [];

    if (session_id) { conditions.push("session_id = ?"); params.push(session_id); }
    if (event_type) { conditions.push("event_type = ?"); params.push(event_type); }
    if (agent_id) { conditions.push("agent_id = ?"); params.push(agent_id); }
    if (from) { conditions.push("timestamp >= ?"); params.push(from); }
    if (to) { conditions.push("timestamp <= ?"); params.push(to); }
    if (request_mode) { conditions.push("request_mode = ?"); params.push(request_mode); }

    // MWT-3B1: task_id filter — exact match or null (unassigned) only
    if (task_id !== undefined) {
      if (task_id === null) {
        conditions.push("task_id IS NULL");
      } else {
        conditions.push("task_id = ?");
        params.push(task_id);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRow = this.db.prepare(`SELECT COUNT(*) as total FROM events ${where}`).get(...params) as any;
    const total = countRow?.total || 0;
    const offset = (page - 1) * limit;
    const hasMore = offset + limit < total;

    const rows = this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as EventIndexRow[];

    return { events: rows.reverse(), total, page, limit, hasMore };
  }

  /**
   * List all sessions with summary stats.
   */
  listSessions(limit = 50): SessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT
          session_id,
          MIN(timestamp) as first_event,
          MAX(timestamp) as last_event,
          COUNT(*) as event_count,
          SUM(CASE WHEN event_type = 'model_call' THEN 1 ELSE 0 END) as model_calls,
          SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as tool_calls,
          COALESCE(SUM(token_count), 0) as total_tokens,
          COALESCE(GROUP_CONCAT(DISTINCT agent_id), '') as agent_list
        FROM events
        GROUP BY session_id
        ORDER BY last_event DESC
        LIMIT ?`
      )
      .all(limit) as any[];

    return rows.map((r: any) => ({
      session_id: r.session_id,
      first_event: r.first_event,
      last_event: r.last_event,
      event_count: r.event_count,
      model_calls: r.model_calls,
      tool_calls: r.tool_calls,
      total_tokens: r.total_tokens,
      agents: r.agent_list ? r.agent_list.split(",").filter(Boolean) : [],
    }));
  }

  /**
   * Aggregate statistics (replaces full-JSONL-scan summary).
   */
  getStats(): {
    total_events: number;
    model_calls: number;
    tool_calls: number;
    streaming_calls: number;
    non_streaming_calls: number;
    total_tokens: number;
    total_cost: number;
    hash_coverage_pct: number;
    success_count: number;
    failure_count: number;
    unique_sessions: number;
    unique_agents: number;
  } {
    const row = this.db
      .prepare(
        `SELECT
          COUNT(*) as total_events,
          SUM(CASE WHEN event_type = 'model_call' THEN 1 ELSE 0 END) as model_calls,
          SUM(CASE WHEN event_type = 'tool_call' THEN 1 ELSE 0 END) as tool_calls,
          SUM(CASE WHEN request_mode = 'streaming' THEN 1 ELSE 0 END) as streaming_calls,
          SUM(CASE WHEN request_mode = 'non_streaming' THEN 1 ELSE 0 END) as non_streaming_calls,
          COALESCE(SUM(token_count), 0) as total_tokens,
          COALESCE(SUM(cost_estimate), 0) as total_cost,
          CASE
            WHEN COUNT(*) = 0 THEN 0
            ELSE ROUND(
              100.0 * (SUM(CASE WHEN output_hash IS NOT NULL AND input_hash IS NOT NULL THEN 1 ELSE 0 END))
              / COUNT(*), 1
            )
          END as hash_coverage_pct,
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) as success_count,
          SUM(CASE WHEN status = 'failure' THEN 1 ELSE 0 END) as failure_count,
          COUNT(DISTINCT session_id) as unique_sessions,
          COUNT(DISTINCT agent_id) as unique_agents
        FROM events`
      )
      .get() as any;

    return {
      total_events: row.total_events || 0,
      model_calls: row.model_calls || 0,
      tool_calls: row.tool_calls || 0,
      streaming_calls: row.streaming_calls || 0,
      non_streaming_calls: row.non_streaming_calls || 0,
      total_tokens: row.total_tokens || 0,
      total_cost: row.total_cost || 0,
      hash_coverage_pct: row.hash_coverage_pct || 0,
      success_count: row.success_count || 0,
      failure_count: row.failure_count || 0,
      unique_sessions: row.unique_sessions || 0,
      unique_agents: row.unique_agents || 0,
    };
  }

  /**
   * Get a single event by ID.
   */
  getEventById(eventId: string): EventIndexRow | undefined {
    return this.db.prepare("SELECT * FROM events WHERE event_id = ?").get(eventId) as EventIndexRow | undefined;
  }

  getEventCount(): number {
    return (this.db.prepare("SELECT COUNT(*) as count FROM events").get() as any)?.count || 0;
  }

  getDbPath(): string {
    return this.dbPath;
  }

  close(): void {
    this.db.close();
  }
}

// Singleton
let _instance: EventIndex | null = null;

export function getEventIndex(eventsJsonlPath?: string): EventIndex {
  if (!_instance) {
    const defaultPath = eventsJsonlPath || ".trustos/events.jsonl";
    _instance = new EventIndex(defaultPath);
    const synced = _instance.syncFromJsonl();
    if (synced > 0) {
      console.log(`[EventIndex] Synced ${synced} events from JSONL`);
    }
  }
  return _instance;
}

// Allow reset for testing
export function resetEventIndex(): void {
  if (_instance) {
    _instance.close();
    _instance = null;
  }
}
