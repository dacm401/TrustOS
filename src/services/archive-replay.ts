/**
 * Archive Replay — answer repeated questions from the task archive.
 *
 * Replay answers repeated questions from `task_archives`, which holds the
 * user's original input (`user_input`) and the worker's result
 * (`slow_execution->>'result'`). This is the O(1) token win: a repeated or
 * highly similar question is answered from history instead of paying for a
 * fresh LLM round-trip.
 *
 * NOTE (RFC-002 Phase 0a): the original O-005 `delegation_archive` table was a
 * dead/empty duplicate of `task_archives` and has been removed. Replay now
 * reads `task_archives` directly — giving it real data instead of an empty
 * table.
 *
 * SAFETY RULES (the reason replay is gated so heavily)
 * ----------------------------------------------------
 * A wrong-but-plausible historical answer is worse than a slow fresh one.
 * Replay therefore requires ALL of:
 *   1. Very high similarity (default 0.9 — near-identical questions only)
 *   2. Not time-sensitive ("今天天气" yesterday ≠ today)
 *   3. The archived entry actually completed with a result
 *   4. Explicitly enabled (default on, but one env var to disable)
 *
 * Every replayed answer is LABELLED as coming from the archive, so the user
 * can tell it is not freshly generated and can ask again if it looks stale.
 */

import { query } from "../db/connection.js";
import { isTimeSensitive, keywordRelevance } from "./text/similarity.js";

export interface ReplayArchiveEntry {
  id: string;
  task_id: string;
  user_id: string;
  session_id: string;
  original_message: string;
  slow_result: string;
  status: string;
  completed_at: string | null;
  score: number;
}

export interface ArchiveHit {
  entry: ReplayArchiveEntry;
  score: number;
}

export interface ReplayResult {
  /** Set when the question can be answered from the archive. */
  hit: ArchiveHit | null;
  /** Human-readable reason — logged so the decision is auditable. */
  reason: string;
}

/** "off" | "direct" (default). Reserved: "context" for future use. */
export type ReplayMode = "off" | "direct";

export function getReplayMode(): ReplayMode {
  const raw = (process.env.TRUSTOS_ARCHIVE_REPLAY ?? "direct").toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return "off";
  return "direct";
}

function getThreshold(): number {
  const raw = Number(process.env.TRUSTOS_ARCHIVE_REPLAY_THRESHOLD);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.9;
}

/**
 * Look for an archive entry that can answer `message` directly.
 *
 * Fails open in the safe direction: any error or missing data yields
 * `{ hit: null }`, so the caller falls through to the normal path.
 */
export async function findReplayableAnswer(
  userId: string,
  message: string
): Promise<ReplayResult> {
  if (getReplayMode() === "off") {
    return { hit: null, reason: "replay_disabled" };
  }
  if (!userId || !message?.trim()) {
    return { hit: null, reason: "empty_input" };
  }

  // Rule 2: never replay time-sensitive questions from history.
  if (isTimeSensitive(message)) {
    return { hit: null, reason: "time_sensitive_query" };
  }

  const threshold = getThreshold();

  try {
    // RFC-002 Phase 0a: source of truth is task_archives (the live, written
    // table). delegation_archive was a dead/empty duplicate and has been removed.
    const result = await query(
      `SELECT id, task_id, user_id, session_id, user_input,
              slow_execution->>'result' AS result_text, status, updated_at
       FROM task_archives
       WHERE user_id = $1 AND status = 'completed'
         AND slow_execution->>'result' IS NOT NULL
       ORDER BY created_at DESC LIMIT 20`,
      [userId]
    );

    const candidates: ReplayArchiveEntry[] = result.rows
      .map((r: any) => ({
        id: r.id,
        task_id: r.task_id,
        user_id: r.user_id,
        session_id: r.session_id,
        original_message: r.user_input,
        slow_result: r.result_text,
        status: r.status,
        completed_at: r.updated_at ? new Date(r.updated_at).toISOString() : null,
        // Coverage-based similarity (NOT Jaccard): a longer archived question
        // that fully contains the current one must still score 1.0.
        score: keywordRelevance(message, r.user_input),
      }))
      .filter((c) => c.score >= threshold);

    if (candidates.length === 0) {
      return { hit: null, reason: "no_similar_archive_entry" };
    }

    const best = candidates[0];

    // Rule 3: only completed entries with an actual result are replayable.
    if (!best.slow_result || best.slow_result.trim().length === 0) {
      return { hit: null, reason: "archive_entry_has_no_result" };
    }
    // Rule 2 (again, on the stored side): the archived question must not
    // have been time-sensitive either.
    if (isTimeSensitive(best.original_message)) {
      return { hit: null, reason: "time_sensitive_archive_entry" };
    }

    return { hit: { entry: best, score: best.score }, reason: "archive_hit" };
  } catch {
    // Replay must never break a turn.
    return { hit: null, reason: "archive_lookup_failed" };
  }
}

/**
 * Render a replayed answer.
 *
 * The label matters: the user must know this is a historical answer, not a
 * freshly generated one, so they can judge staleness themselves.
 */
export function renderReplay(hit: ArchiveHit): string {
  const when = hit.entry.completed_at
    ? new Date(hit.entry.completed_at).toISOString().slice(0, 10)
    : "未知时间";
  return (
    `【历史档案命中 · 未调用模型】\n\n` +
    `你曾问过高度相似的问题（相似度 ${(hit.score * 100).toFixed(0)}%，` +
    `原答案生成于 ${when}）。以下是当时的答案：\n\n` +
    `${hit.entry.slow_result}\n\n` +
    `——若该答案已过时，请重新提问，我会重新生成。`
  );
}
