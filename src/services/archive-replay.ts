/**
 * Archive Replay — answer repeated questions from the delegation archive.
 *
 * WHY THIS EXISTS
 * ---------------
 * The 04-16 design (O-005) introduced `delegation_archive` with an explicit
 * goal: 「新任务开新对话、查档案库」 — an O(1) token model where a repeated or
 * highly similar question is answered from history instead of paying for a
 * fresh LLM round-trip. That was the product's original cost advantage.
 *
 * Over time the retrieval side disappeared: rows were still written (via a
 * backward-compat path) but nothing ever read them — the worst possible
 * state: paying write cost for zero retrieval benefit. This module restores
 * the read path.
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

import { DelegationArchiveRepo } from "../db/repositories.js";
import type { DelegationArchiveEntry } from "../db/repositories/delegation.js";
import { isTimeSensitive } from "./text/similarity.js";

export interface ArchiveHit {
  entry: DelegationArchiveEntry;
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
    const candidates = await DelegationArchiveRepo.findSimilar(userId, message, {
      limit: 3,
      minScore: threshold,
    });

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
