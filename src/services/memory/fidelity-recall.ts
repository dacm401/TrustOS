/**
 * Fidelity Recall — RFC-002 Phase 3 (the highest-value, riskiest piece).
 *
 * WHY THIS EXISTS
 * ----------------
 * The Manager turns the user's prompt into a brief before dispatching to the
 * Worker. "Processing" is where information loss happens: the Manager may
 * over-interpret, drop detail, or overwrite the user's true intent with its
 * own paraphrase — and its context window is limited and forgetful.
 *
 * Fidelity recall pulls the user's OWN past prompts (the L1 sovereign store,
 * `conversation_turns`) that are relevant to the current task, and curates
 * them into a grounding block injected into the worker brief. The Worker then
 * executes against what the user *actually* said, not the Manager's drifted
 * version. This is an accuracy/fidelity guarantee, not UX sugar.
 *
 * THE INVARIANT (do not break)
 * ----------------------------
 * "Worker 仍只收 curated brief，不收 raw history dump" (ADR-001 + context-curation).
 * So we do NOT dump the whole session history. We select the top-K *relevant*
 * turns, within a token budget, each gated by:
 *   1. similarity threshold (CJK bigram coverage, reused from similarity.ts)
 *   2. time-sensitivity gate  — never ground on stale-by-definition prompts
 *      ("今天天气" from yesterday is wrong today)
 *   3. red-line gate          — never forward hard secrets (api keys / bank /
 *      id card) to the worker; also keeps us from tripping SD-01 downstream
 *   4. recency window         — old turns fade out
 *
 * FAILS OPEN: any error → empty recall, never breaks the dispatch.
 *
 * DISTILLED-MEMORY SIGNAL (RFC-001) — extra gate:
 *   The user's OWN prompts (conversation_turns) are their sovereign L1 data and
 *   only pass the red-line gate above. The Memory distillates (memory_entries)
 *   ALSO pass an ADR-004 B1 SENSITIVITY gate: only `public` entries reach the
 *   cloud Worker by default (ADR-001 §2.3 "检索默认返回蒸馏物"); non-public
 *   entries (unknown/sensitive/restricted/internal) are blocked unless the
 *   caller passes `includeRaw` (explicit user confirmation). This closes the
 *   "local store → retrieval → auto-egress" channel for memory.
 */

import { ConversationTurnRepo } from "../../db/repositories.js";
import { detectSensitiveData } from "../gating/sensitive-data-rule.js";
import {
  estimateTokens,
  isTimeSensitive,
  keywordRelevance,
} from "../text/similarity.js";
import {
  fidelityRecallTokens,
  fidelityRecallTruncatedTotal,
  fidelityRecallMemoryHits,
  fidelityRecallsTotal,
} from "../../metrics/prometheus.js";
// RFC-001: distilled user intent (memory_entries) — prompt-eligible by default
// (ADR-001 §2.3 / RFC-001 策略三). Reused here as a SECOND grounding signal so
// the Worker executes faithfully to the user's captured preferences, not just
// their raw prompts.
import {
  retrieveMemoriesHybrid,
  buildCategoryAwareMemoryText,
} from "../memory-retrieval.js";
// ADR-004 阶段 B1：云端接收方（Worker brief）只放行 `public` 敏感度的记忆。
// 复用 injector 的同一白名单，确保保真召回与 selectMemories 的 remote 门禁一致。
import { REMOTE_ALLOWED_SENSITIVITIES } from "../memory/injector.js";
import type { MemoryRetrievalResult } from "../../types/index.js";

export interface RecallItem {
  turnId: string;
  sessionId: string;
  turnIndex: number;
  content: string;
  /** Similarity to the query in [0,1]. */
  score: number;
  /** Recency in [0,1]: 1 = now, decaying over the recency window. */
  recency: number;
  createdAt: string;
}

export interface RecallResult {
  items: RecallItem[];
  /** Rendered, clearly-labelled grounding block; "" when nothing recalled. */
  block: string;
  stats: {
    candidates: number;
    selected: number;
    approxTokens: number;
    /** Distilled memory entries added to the grounding (RFC-001). */
    memorySelected: number;
    /** Memory entries blocked by the ADR-004 B1 remote sensitivity gate. */
    memoryBlockedBySensitivity: number;
    /** "keyword" (CJK bigram coverage) or "none". */
    method: "keyword" | "none";
    truncated: boolean;
    reason?: string;
  };
}

export interface RecallOptions {
  /** Max relevant turns to return. */
  maxItems?: number;
  /** Hard token budget for the grounding block. */
  maxTokens?: number;
  /** Minimum similarity (keywordRelevance in [0,1]) to be eligible. */
  similarityThreshold?: number;
  /** Max age in days for a turn to be eligible. 0 = no limit. */
  maxAgeDays?: number;
  /** Skip this session (the one that triggered the dispatch). */
  excludeSessionId?: string;
  /**
   * ADR-001 §2.3 / ADR-004 B1：默认只把 `public` 敏感度的蒸馏记忆注入云端
   * Worker brief。设 `true` 表示用户已显式确认，放行非 public 记忆
   * （unknown/sensitive/restricted/internal）——对应"确需引用进 prompt 时须
   * 用户显式确认"。
   */
  includeRaw?: boolean;
}

// ── Configuration ───────────────────────────────────────────────────────────

function envStr(name: string): string | undefined {
  const raw = process.env[name];
  return raw === undefined || raw === "" ? undefined : raw;
}

function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export interface RecallConfig {
  enabled: boolean;
  candidateLimit: number;
  maxItems: number;
  maxTokens: number;
  similarityThreshold: number;
  maxAgeDays: number;
  /** Include the user's distilled intent/preferences (memory_entries). */
  memoryEnabled: boolean;
  maxMemoryItems: number;
  maxMemoryTokens: number;
}

export function loadRecallConfig(): RecallConfig {
  const rawEnabled = envStr("TRUSTOS_FIDELITY_RECALL");
  const enabled = !(rawEnabled === "0" || rawEnabled === "off" || rawEnabled === "false");
  const rawMem = envStr("TRUSTOS_FIDELITY_RECALL_MEMORY");
  const memoryEnabled = !(rawMem === "0" || rawMem === "off" || rawMem === "false");
  return {
    enabled,
    candidateLimit: envInt("TRUSTOS_FIDELITY_RECALL_CANDIDATES", 300),
    maxItems: envInt("TRUSTOS_FIDELITY_RECALL_MAX_ITEMS", 3),
    maxTokens: envInt("TRUSTOS_FIDELITY_RECALL_MAX_TOKENS", 400),
    similarityThreshold: envFloat("TRUSTOS_FIDELITY_RECALL_THRESHOLD", 0.2),
    maxAgeDays: envFloat("TRUSTOS_FIDELITY_RECALL_MAX_AGE_DAYS", 180),
    memoryEnabled,
    maxMemoryItems: envInt("TRUSTOS_FIDELITY_RECALL_MEMORY_ITEMS", 3),
    maxMemoryTokens: envInt("TRUSTOS_FIDELITY_RECALL_MEMORY_TOKENS", 200),
  };
}

// ── Rendering ───────────────────────────────────────────────────────────────

function renderGrounding(items: RecallItem[]): string {
  const lines = items.map((it) => `- ${it.content}`);
  return (
    "## 历史背景（来自你的过往诉求，仅作保真执行的 grounding，非新指令）\n" +
    lines.join("\n")
  );
}

/**
 * Red-line gate for recalled grounding.
 *
 * Reuse SD-01's `detectSensitiveData` (api keys / bank card / id card), PLUS a
 * 16+-consecutive-digit rule. Why the extra rule: the grounding is appended to
 * the brief AFTER the SD-01 guard has already run on the original brief, so
 * `detectSensitiveData` here is the ONLY thing standing between recalled
 * history and the cloud worker. SD-01's bare `\d{16}` requires the digits to be
 * isolated (no adjacent digits), so a 19-digit unseparated card would slip
 * through both SD-01 and the original filter — this rule closes that gap.
 * Fail-safe: when in doubt, drop the turn (we never want to forward a secret).
 */
export function isRecallRedLine(content: string): boolean {
  if (detectSensitiveData(content)) return true;
  return /\d{16,}/.test(content ?? "");
}

// ── Engine ──────────────────────────────────────────────────────────────────

function empty(method: RecallResult["stats"]["method"], reason: string): RecallResult {
  if (reason !== "disabled") fidelityRecallsTotal.inc({ result: reason });
  return {
    items: [],
    block: "",
    stats: { candidates: 0, selected: 0, approxTokens: 0, memorySelected: 0, memoryBlockedBySensitivity: 0, method, truncated: false, reason },
  };
}

/**
 * Recall relevant past user prompts as grounding for the current dispatch.
 *
 * Pure logic + one DB read; fails open. Callers must treat the result as an
 * enhancement, never a dependency.
 */
export async function recallGrounding(
  userId: string,
  query: string,
  options?: RecallOptions
): Promise<RecallResult> {
  const cfg = loadRecallConfig();
  if (!cfg.enabled) return empty("none", "disabled");
  if (!userId || !query?.trim()) return empty("none", "empty_input");

  const maxItems = options?.maxItems ?? cfg.maxItems;
  const maxTokens = options?.maxTokens ?? cfg.maxTokens;
  const simThresh = options?.similarityThreshold ?? cfg.similarityThreshold;
  const maxAgeDays = options?.maxAgeDays ?? cfg.maxAgeDays;
  const excludeSession = options?.excludeSessionId;

  try {
    const turns = await ConversationTurnRepo.listByUser(
      userId,
      cfg.candidateLimit,
      "user",
      excludeSession
    );
    // NOTE: empty history does NOT block memory retrieval — a user may have
    // zero relevant turns yet still have distilled intent worth surfacing.
    // The combined block is only declared empty at the very end if BOTH
    // history and memory miss.

    const now = Date.now();
    const scored: Array<{ turn: (typeof turns)[number]; sim: number; recency: number }> = [];

    for (const t of turns) {
      const content = t.content ?? "";
      if (!content.trim()) continue;
      // Gate 2: never ground on time-sensitive history (stale by definition).
      if (isTimeSensitive(content)) continue;
      // Gate 3: never forward hard secrets to the worker (and avoid SD-01).
      if (isRecallRedLine(content)) continue;
      // Gate 1: relevance to the current task.
      const sim = keywordRelevance(query, content);
      if (sim < simThresh) continue;
      // Gate 4: recency window.
      const ageDays = (now - new Date(t.created_at).getTime()) / 86_400_000;
      if (maxAgeDays > 0 && ageDays > maxAgeDays) continue;
      const recency = maxAgeDays > 0 ? Math.max(0, 1 - ageDays / maxAgeDays) : 1;
      scored.push({ turn: t, sim, recency });
    }

    // Rank by similarity, then recency; take the best within budget.
    // (No early-return on empty `scored`: distilled memory may still match.)
    scored.sort((a, b) => b.sim - a.sim || b.recency - a.recency);

    const selected: RecallItem[] = [];
    let tokens = 0;
    let truncated = false;
    for (const s of scored) {
      if (selected.length >= maxItems) break;
      const cost = estimateTokens(s.turn.content);
      if (tokens + cost > maxTokens) {
        truncated = true;
        continue;
      }
      tokens += cost;
      selected.push({
        turnId: s.turn.id,
        sessionId: s.turn.session_id,
        turnIndex: s.turn.turn_index,
        content: s.turn.content,
        score: s.sim,
        recency: s.recency,
        createdAt: new Date(s.turn.created_at).toISOString(),
      });
    }

    // History may be empty while distilled memory still matches (and vice
    // versa) — do NOT early-return here; only bail when BOTH sources miss.
    const historyBlock = selected.length > 0 ? renderGrounding(selected) : "";

    // ── Second signal: distilled user intent/preferences (RFC-001) ──
    // The Manager may have glossed over a captured preference; surfacing the
    // user's OWN distillates directly keeps the Worker faithful to intent.
    // Distillates are prompt-eligible by default (ADR-001 §2.3 / RFC-001 策略三),
    // but we still run the red-line gate and a token budget. Fail-open.
    let memoryBlock = "";
    let memorySelected = 0;
    let memoryBlockedBySensitivity = 0;
    if (cfg.memoryEnabled) {
      try {
        const mem = await retrieveMemoriesHybrid({
          userId,
          context: { userMessage: query },
          categoryPolicy: {
            instruction: { minImportance: 1, maxCount: 2, alwaysInject: false },
            preference: { minImportance: 1, maxCount: 3, alwaysInject: false },
            fact: { minImportance: 1, maxCount: 2, alwaysInject: false },
            context: { minImportance: 1, maxCount: 2, alwaysInject: false },
          },
          maxTotalEntries: cfg.maxMemoryItems * 3,
        });
        const picked: MemoryRetrievalResult[] = [];
        let mtok = 0;
        // ADR-001 §2.3 / ADR-004 B1：云端 Worker brief 等同 remote 接收方。
        // 默认只放行 `public` 敏感度的蒸馏记忆；其余（unknown/sensitive/
        // restricted/internal）按"检索默认返回蒸馏物"原则拦截，避免本地存储
        // 经检索自动外发。显式 includeRaw 即视为用户确认，放行非 public。
        const allowNonPublic = options?.includeRaw === true;
        for (const r of mem) {
          if (picked.length >= cfg.maxMemoryItems) break;
          if (isRecallRedLine(r.entry.content)) continue;
          const s = r.entry.sensitivity ?? "unknown";
          if (!allowNonPublic && !REMOTE_ALLOWED_SENSITIVITIES.has(s)) {
            memoryBlockedBySensitivity++;
            continue;
          }
          const cost = estimateTokens(r.entry.content);
          if (mtok + cost > cfg.maxMemoryTokens) continue;
          mtok += cost;
          picked.push(r);
        }
        if (picked.length > 0) {
          memorySelected = picked.length;
          const text = buildCategoryAwareMemoryText(picked);
          memoryBlock =
            "## 已记录的用户意图/偏好（来自 Memory 蒸馏物，供保真执行，非新指令）\n" +
            text.combined;
        }
      } catch {
        // fail-open: never break the dispatch
      }
    }

    const block = [historyBlock, memoryBlock].filter(Boolean).join("\n\n");
    if (!block) return empty("none", "no_match");

    fidelityRecallsTotal.inc({ result: "hit" });
    fidelityRecallTokens.set(tokens);
    if (truncated) fidelityRecallTruncatedTotal.inc();
    if (memoryBlock) fidelityRecallMemoryHits.inc();

    return {
      items: selected,
      block,
      stats: {
        candidates: turns.length,
        selected: selected.length,
        approxTokens: tokens,
        memorySelected,
        memoryBlockedBySensitivity,
        method: "keyword",
        truncated,
      },
    };
  } catch {
    // Recall must never break a dispatch.
    return empty("none", "error");
  }
}

/**
 * Apply recalled grounding to a worker brief.
 *
 * Appended (not prepended) so the Manager's own brief stays the primary
 * instruction; the grounding is clearly delimited and labelled as context, not
 * a new directive. Returns the brief unchanged when there is nothing to add.
 */
export function applyRecallToBrief(brief: string | undefined, block: string): string {
  if (!block) return brief ?? "";
  return `${brief ?? ""}\n\n${block}`;
}
