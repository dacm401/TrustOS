/**
 * JSONL-backed Event Index (pure JS, zero native dependencies).
 *
 * WHY THIS EXISTS
 * ---------------
 * The SQLite index (event-index.ts) depends on better-sqlite3, a native
 * module. Under `npm install --ignore-scripts` its prebuild is never
 * downloaded, leaving a broken binding that SIGSEGVs (exit 139) the moment
 * it is `require()`d — try/catch cannot recover from a segfault. Building it
 * from source on alpine needs a full toolchain and is prohibitively slow.
 *
 * The architecture already declares JSONL as the source of truth and SQLite
 * merely a rebuildable cache, so we can serve the same contract straight
 * from JSONL with no native code at all.
 *
 * TRADE-OFF
 * ---------
 * Reads are O(n) over the log instead of indexed lookups. For the Private
 * Beta event volumes this is imperceptible, and it buys: no segfaults, no
 * toolchain, and the index can never drift from the source of truth.
 */

import fs from "node:fs";
import type { TrstEventEnvelope } from "./event-envelope.js";
// Type-only imports are erased at compile time, so importing these does NOT
// pull better-sqlite3 into the runtime graph.
import type {
  EventIndexRow,
  PaginatedEvents,
  SessionSummary,
} from "./event-index.js";

type AnyEvent = Record<string, unknown>;

function asStr(v: unknown): string | null {
  return typeof v === "string" ? v : v == null ? null : String(v);
}
function asNum(v: unknown): number | null {
  return typeof v === "number" ? v : v == null ? null : Number(v);
}

function toRow(e: AnyEvent): EventIndexRow {
  return {
    event_id: asStr(e.event_id) ?? "",
    event_type: asStr(e.event_type) ?? "",
    timestamp: asStr(e.timestamp) ?? "",
    session_id: asStr(e.session_id) ?? "",
    agent_id: asStr(e.agent_id),
    status: asStr(e.status) ?? "success",
    request_mode: asStr(e.request_mode),
    model: asStr(e.model),
    token_count: asNum(e.token_count),
    input_hash: asStr(e.input_hash),
    output_hash: asStr(e.output_hash),
    error_code: asStr(e.error_code),
    task_id: asStr(e.task_id),
    event_hash: asStr(e.event_hash),
    prev_hash: asStr(e.prev_hash),
  };
}

export class JsonlEventIndex {
  private jsonlPath: string;
  private cache: EventIndexRow[] | null = null;
  private cacheMtimeMs = -1;
  private cacheSize = -1;

  constructor(jsonlPath: string) {
    this.jsonlPath = jsonlPath;
  }

  /** Read + parse the log, caching until the file changes. */
  private rows(): EventIndexRow[] {
    if (!fs.existsSync(this.jsonlPath)) return [];
    const stat = fs.statSync(this.jsonlPath);
    if (
      this.cache &&
      this.cacheMtimeMs === stat.mtimeMs &&
      this.cacheSize === stat.size
    ) {
      return this.cache;
    }

    const content = fs.readFileSync(this.jsonlPath, "utf-8");
    const out: EventIndexRow[] = [];
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(toRow(JSON.parse(trimmed) as AnyEvent));
      } catch {
        // Skip malformed lines — the log must never break the reader.
      }
    }
    this.cache = out;
    this.cacheMtimeMs = stat.mtimeMs;
    this.cacheSize = stat.size;
    return out;
  }

  /**
   * Kept for API compatibility with the SQLite index.
   * A no-op here: JSONL *is* the source of truth, so there is nothing to sync.
   */
  syncFromJsonl(): number {
    return this.rows().length;
  }

  /** Append is handled by jsonl-event-store; just invalidate the cache. */
  appendEvent(_e: TrstEventEnvelope): void {
    this.cache = null;
  }

  getEventCount(): number {
    return this.rows().length;
  }

  getEventById(eventId: string): EventIndexRow | undefined {
    return this.rows().find((r) => r.event_id === eventId);
  }

  queryEvents(options: {
    page?: number;
    limit?: number;
    session_id?: string;
    event_type?: string;
    agent_id?: string;
    from?: string;
    to?: string;
    request_mode?: string;
    task_id?: string | null;
  } = {}): PaginatedEvents {
    const {
      page = 1,
      limit = 50,
      session_id,
      event_type,
      agent_id,
      from,
      to,
      request_mode,
      task_id,
    } = options;

    let filtered = this.rows();

    if (session_id) filtered = filtered.filter((r) => r.session_id === session_id);
    if (event_type) filtered = filtered.filter((r) => r.event_type === event_type);
    if (agent_id) filtered = filtered.filter((r) => r.agent_id === agent_id);
    if (from) filtered = filtered.filter((r) => r.timestamp >= from);
    if (to) filtered = filtered.filter((r) => r.timestamp <= to);
    if (request_mode) filtered = filtered.filter((r) => r.request_mode === request_mode);
    if (task_id !== undefined) {
      filtered =
        task_id === null
          ? filtered.filter((r) => r.task_id === null)
          : filtered.filter((r) => r.task_id === task_id);
    }

    const total = filtered.length;
    const offset = (page - 1) * limit;
    // SQL index returns newest-last ( caller expects chronological order ).
    const sorted = [...filtered].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const events = sorted.slice(offset, offset + limit);

    return { events, total, page, limit, hasMore: offset + limit < total };
  }

  listSessions(limit = 50): SessionSummary[] {
    const bySession = new Map<string, EventIndexRow[]>();
    for (const r of this.rows()) {
      const arr = bySession.get(r.session_id);
      if (arr) arr.push(r);
      else bySession.set(r.session_id, [r]);
    }

    const summaries: SessionSummary[] = [];
    for (const [session_id, evs] of bySession) {
      const sorted = [...evs].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      const agents = Array.from(
        new Set(sorted.map((e) => e.agent_id).filter((a): a is string => !!a)),
      );
      summaries.push({
        session_id,
        first_event: sorted[0]?.timestamp ?? "",
        last_event: sorted[sorted.length - 1]?.timestamp ?? "",
        event_count: sorted.length,
        model_calls: sorted.filter((e) => e.event_type === "model_call").length,
        tool_calls: sorted.filter((e) => e.event_type === "tool_call").length,
        total_tokens: sorted.reduce((sum, e) => sum + (e.token_count ?? 0), 0),
        agents,
      });
    }

    return summaries
      .sort((a, b) => b.last_event.localeCompare(a.last_event))
      .slice(0, limit);
  }

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
    const rows = this.rows();
    const total = rows.length;
    const withHashes = rows.filter((r) => !!r.output_hash && !!r.input_hash).length;

    return {
      total_events: total,
      model_calls: rows.filter((r) => r.event_type === "model_call").length,
      tool_calls: rows.filter((r) => r.event_type === "tool_call").length,
      streaming_calls: rows.filter((r) => r.request_mode === "streaming").length,
      non_streaming_calls: rows.filter((r) => r.request_mode === "non_streaming").length,
      total_tokens: rows.reduce((s, r) => s + (r.token_count ?? 0), 0),
      total_cost: 0,
      hash_coverage_pct:
        total === 0 ? 0 : Math.round((1000 * withHashes) / total) / 10,
      success_count: rows.filter((r) => r.status === "success").length,
      failure_count: rows.filter((r) => r.status === "failure").length,
      unique_sessions: new Set(rows.map((r) => r.session_id)).size,
      unique_agents: new Set(rows.map((r) => r.agent_id).filter(Boolean)).size,
    };
  }

  /** No separate DB file — the log itself is the store. */
  getDbPath(): string {
    return this.jsonlPath;
  }

  close(): void {
    this.cache = null;
  }
}

let _instance: JsonlEventIndex | null = null;

/** Get (or create) the process-wide JSONL index for a log path. */
export function getJsonlEventIndex(jsonlPath: string): JsonlEventIndex {
  if (!_instance || _instance.getDbPath() !== jsonlPath) {
    _instance?.close();
    _instance = new JsonlEventIndex(jsonlPath);
  }
  return _instance;
}
