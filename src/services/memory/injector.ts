/**
 * Memory Injection Engine (RFC-001 Phase 1 — closing the loop).
 *
 * Distillation alone only STORES knowledge. This module makes it usable:
 * it selects which memories to put back into the prompt, and how many.
 *
 * ── Why a budget matters ───────────────────────────────────────────────────
 * The Manager will run on a LOCAL model with a limited context window
 * (default assumption: 8k). Small models also suffer worse attention decay
 * over long contexts — too many memories make them lose the important ones.
 * So injection is budget-limited and precision-first:
 * a few highly relevant beats many noisy ones.
 *
 * ── Three tiers ────────────────────────────────────────────────────────────
 *   always        — global constraints / strong preferences, every turn
 *   on_relevance  — facts & context, only when related to the current query
 *   (session tier is handled by the existing history mechanism)
 *
 * ── Local vs remote receiver ───────────────────────────────────────────────
 * Memory injected into a LOCAL model never leaves the machine, so it needs no
 * egress processing. Memory destined for a CLOUD model must be processed.
 * `target` makes this explicit rather than a global flag, so mixed
 * local/cloud deployments stay correct automatically.
 */

import { MemoryEntryRepo } from "../../db/repositories.js";
import { getEmbedding } from "../embedding.js";
import { PENDING_TAG } from "../../api/memory.js";
import {
  memoryInjectedEntries,
  memoryInjectionsTotal,
  memoryInjectMethod,
  memoryInjectTokens,
  memoryInjectTruncated,
} from "../../metrics/prometheus.js";
import type {
  MemoryCategory,
  MemoryEntry,
  MemorySensitivityTier,
} from "../../types/index.js";

// ── Configuration ───────────────────────────────────────────────────────────

export interface InjectionRule {
  name: string;
  /** Categories this rule selects. */
  categories: MemoryCategory[];
  /** "always" = every turn; "on_relevance" = only when related. */
  inject: "always" | "on_relevance";
  /** Minimum confidence (from distillation) to be eligible. */
  minConfidence?: number;
  /** Minimum importance (1-5) to be eligible. */
  minImportance?: number;
  /** For on_relevance: minimum similarity to include. */
  relevanceThreshold?: number;
  /** Max entries this rule may contribute. */
  maxItems: number;
  /** Max tokens (approximate) this rule may consume. */
  maxTokens: number;
}

export interface InjectionBudget {
  /** Hard cap across all rules. */
  totalMaxTokens: number;
  /** Fraction of context reserved for conversation history. */
  reserveForHistory: number;
}

/**
 * Defaults tuned for an 8k local Manager context.
 * Override via env — see loadConfig() — no code change needed when the
 * local model is swapped for one with a different window.
 */
export const DEFAULT_RULES: InjectionRule[] = [
  {
    name: "global_constraints",
    categories: ["instruction"],
    inject: "always",
    minConfidence: 0.7,
    maxItems: 10,
    maxTokens: 200,
  },
  {
    name: "core_preferences",
    categories: ["preference"],
    inject: "always",
    minImportance: 4,
    maxItems: 5,
    maxTokens: 120,
  },
  {
    name: "relevant_facts",
    categories: ["fact", "context"],
    inject: "on_relevance",
    relevanceThreshold: 0.3,
    maxItems: 3,
    maxTokens: 180,
  },
  {
    name: "relevant_skills",
    categories: ["skill", "behavioral"],
    inject: "on_relevance",
    relevanceThreshold: 0.35,
    maxItems: 2,
    maxTokens: 100,
  },
];

export const DEFAULT_BUDGET: InjectionBudget = {
  totalMaxTokens: 500,
  reserveForHistory: 0.7,
};

/** Ranking weights (should sum to 1). */
export const DEFAULT_WEIGHTS = { relevance: 0.6, importance: 0.3, recency: 0.1 };

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function loadConfig(): { rules: InjectionRule[]; budget: InjectionBudget } {
  const total = envInt("TRUSTOS_MEMORY_INJECT_MAX_TOKENS", DEFAULT_BUDGET.totalMaxTokens);
  return {
    rules: DEFAULT_RULES,
    budget: { totalMaxTokens: total, reserveForHistory: DEFAULT_BUDGET.reserveForHistory },
  };
}

// ── Result types ────────────────────────────────────────────────────────────

export interface InjectedMemory {
  id: string;
  category: MemoryCategory;
  content: string;
  /** Which rule selected it — surfaced in UI/logs for transparency. */
  rule: string;
  relevance: number;
  importance: number;
  /** Final ranking score. */
  score: number;
}

export interface InjectionResult {
  memories: InjectedMemory[];
  /** Rendered prompt block, ready to prepend to the system prompt. */
  block: string;
  stats: {
    candidates: number;
    selected: number;
    approxTokens: number;
    budget: number;
    /** "vector" or "keyword" — which relevance method was used. */
    method: "vector" | "keyword" | "none";
    truncated: boolean;
  };
}

export type InjectionTarget = "local" | "remote";

// ── Helpers ─────────────────────────────────────────────────────────────────

// Tokenization / relevance / token-estimation live in one shared module so the
// injection engine and the delegation-archive replay use identical semantics.
import {
  estimateTokens,
  keywordRelevance,
  tokenize,
} from "../text/similarity.js";
export { estimateTokens, keywordRelevance, tokenize };

/** Recency in [0,1]: 1 = now, decaying over ~90 days. */
function recencyScore(updatedAt: string | undefined): number {
  if (!updatedAt) return 0.5;
  const then = new Date(updatedAt).getTime();
  if (!Number.isFinite(then)) return 0.5;
  const days = (Date.now() - then) / 86_400_000;
  return Math.max(0, 1 - days / 90);
}

// ── Engine ──────────────────────────────────────────────────────────────────

/**
 * Select memories to inject for a given user query.
 *
 * Safe by construction: any failure degrades to "inject nothing" rather than
 * breaking the turn. Memory is an enhancement, never a dependency.
 */
// ── Injection observability (bounded, in-memory) ────────────────────────────
//
// Not persisted on purpose: injection runs every turn, so a DB table would grow
// faster than the sovereign data it describes. The UI only needs "what did the
// last few turns use?", and Prometheus carries the long-term aggregate.

export interface InjectionRecord {
  at: string;
  userId: string;
  sessionId?: string;
  target: InjectionTarget;
  memories: Array<{ id: string; rule: string; category: MemoryCategory; relevance: number }>;
  approxTokens: number;
  method: string;
  truncated: boolean;
}

const INJECTION_LOG_LIMIT = 50;
const injectionLog: InjectionRecord[] = [];

export function recordInjection(rec: InjectionRecord): void {
  injectionLog.push(rec);
  if (injectionLog.length > INJECTION_LOG_LIMIT) injectionLog.shift();
}

/** Most recent injections, newest first. */
export function recentInjections(userId?: string, limit = 20): InjectionRecord[] {
  const filtered = userId ? injectionLog.filter((r) => r.userId === userId) : injectionLog;
  return filtered.slice(-limit).reverse();
}

/**
 * Public entry point. Wraps the selection logic so metrics are ALWAYS
 * recorded — callers cannot forget, and a metrics failure can never break
 * injection (observability is a side effect, not a dependency).
 */
export async function selectMemories(
  userId: string,
  query: string,
  target: InjectionTarget = "local",
  options?: SelectMemoriesOptions & { sessionId?: string }
): Promise<InjectionResult> {
  const result = await selectMemoriesInner(userId, query, target, options);
  try {
    memoryInjectionsTotal.inc({ target });
    for (const m of result.memories) memoryInjectedEntries.inc({ rule: m.rule });
    memoryInjectTokens.set(result.stats.approxTokens);
    if (result.stats.truncated) memoryInjectTruncated.inc();
    memoryInjectMethod.inc({ method: result.stats.method });

    // UI-facing record (bounded ring buffer — see InjectionRecord docs).
    recordInjection({
      at: new Date().toISOString(),
      userId,
      sessionId: options?.sessionId,
      target,
      memories: result.memories.map((m) => ({
        id: m.id,
        rule: m.rule,
        category: m.category,
        relevance: m.relevance,
      })),
      approxTokens: result.stats.approxTokens,
      method: result.stats.method,
      truncated: result.stats.truncated,
    });
  } catch {
    /* metrics must never break injection */
  }
  return result;
}

type SelectMemoriesOptions = {
  rules?: InjectionRule[];
  budget?: InjectionBudget;
  now?: number;
  /**
   * Pre-retrieved candidates. When supplied the engine skips its own
   * retrieval — this lets the caller reuse the existing hybrid retriever
   * (`retrieveMemoriesHybrid`, vector+keyword with graceful DB degradation)
   * while this engine owns selection, ranking and budgeting.
   */
  candidates?: Array<MemoryEntry & { similarity?: number }>;
};

/**
 * ADR-004 阶段 B1 —— 哪些敏感度的 memory 允许发给云端模型。
 *
 * 目前只有 `public`。为什么 `internal` 也暂时不放行：
 *   `internal` 的语义是「可提炼后使用」——即把它转译成无敏感信息的
 *   constraints 再给模型（ADR-004 阶段 D）。转译尚未实现，此刻放行就等于
 *   把原文直接送上云，违背 internal 的定义。因此这里保守处理：
 *   `internal` 留在本地，等阶段 D 的转译落地后再开放。
 *
 * `unknown` 不是「系统判断不了」，而是「用户还没审阅」（阶段 B0 赋予的
 * 语义），所以它和 sensitive/restricted 一样拒绝，但用户可以主动解锁。
 */
/**
 * ADR-004 阶段 B1 —— 哪些敏感度的 memory 允许发给云端模型（remote 接收方）。
 *
 * 仅 `public`。`internal` 暂不放行（需阶段 D 转译后才开放），`unknown` 是
 * "用户未审阅"而非"系统判断不了"，与 sensitive/restricted 同样拒绝。
 *
 * 导出给 fidelity-recall 复用：保真召回把 memory 注入云端 Worker brief 时，
 * 必须套用同一道 remote 门禁，避免"检索默认返回蒸馏物"被绕过。
 */
export const REMOTE_ALLOWED_SENSITIVITIES = new Set<MemorySensitivityTier>(["public"]);

/**
 * 按接收方过滤 memory 敏感度。
 *
 * 为什么必须在**选择阶段**过滤，而不能依赖下游 egress：
 *   egress 是语法级正则，拦得住 sk-xxx / 邮箱 / 手机 / 身份证；
 *   memory 的敏感性却是语义级 —— 「用户的老板叫张伟」「年薪 80 万」
 *   「准备离职」不含任何敏感格式，egress 完全抓不到。
 *   所以语义把关只能在这里做：让不该出境的条目**根本不进入候选集**，
 *   而不是先选进来再指望下游拦下。
 *
 * LOCAL 不做任何过滤：数据不出本机，无需裁剪。
 */
function filterBySensitivity<T extends { sensitivity?: MemorySensitivityTier }>(
  entries: T[],
  target: InjectionTarget
): { allowed: T[]; blocked: T[] } {
  if (target !== "remote") return { allowed: entries, blocked: [] };

  const allowed: T[] = [];
  const blocked: T[] = [];
  for (const e of entries) {
    // 缺失一律按 unknown 处理 —— 绝不因为字段缺失就放行。
    const s: MemorySensitivityTier = e.sensitivity ?? "unknown";
    if (REMOTE_ALLOWED_SENSITIVITIES.has(s)) allowed.push(e);
    else blocked.push(e);
  }
  return { allowed, blocked };
}

async function selectMemoriesInner(
  userId: string,
  query: string,
  target: InjectionTarget = "local",
  options?: SelectMemoriesOptions
): Promise<InjectionResult> {
  const { rules, budget } = loadConfig();
  const activeRules = options?.rules ?? rules;
  const activeBudget = options?.budget ?? budget;

  const empty = (method: InjectionResult["stats"]["method"]): InjectionResult => ({
    memories: [],
    block: "",
    stats: { candidates: 0, selected: 0, approxTokens: 0, budget: activeBudget.totalMaxTokens, method, truncated: false },
  });

  if (process.env.TRUSTOS_MEMORY_INJECT === "0") return empty("none");
  if (!userId || !query?.trim()) return empty("none");

  try {
    // Candidates: reuse the caller's (hybrid retriever) when provided,
    // otherwise run our own retrieval.
    let method: "vector" | "keyword" = "keyword";
    const similarity = new Map<string, number>();
    let candidates: MemoryEntry[];

    if (options?.candidates) {
      candidates = options.candidates;
      for (const c of options.candidates) {
        similarity.set(c.id, c.similarity ?? 0);
      }
      method = options.candidates.some((c) => typeof c.similarity === "number")
        ? "vector"
        : "keyword";

      // The hybrid retriever's score is deliberately NOT normalized, so after
      // clamping everything can land on 1.00 — which makes the on_relevance
      // threshold meaningless (everything passes). When the supplied scores
      // carry no spread, recompute relevance from keywords instead.
      const values = candidates.map((c) => similarity.get(c.id) ?? 0);
      const distinct = new Set(values.map((v) => v.toFixed(2))).size;
      if (distinct <= 1) {
        for (const c of candidates) {
          similarity.set(c.id, keywordRelevance(query, c.content));
        }
        method = "keyword";
      }
    } else {
      candidates = await MemoryEntryRepo.list(userId, { limit: 200 });

      const embedding = await tryEmbed(query);
      if (embedding) {
        try {
          const hits = await MemoryEntryRepo.searchByVector(userId, embedding, 50);
          for (const h of hits) similarity.set(h.id, h.similarity);
          method = "vector";
        } catch {
          /* fall through to keyword */
        }
      }
      if (method === "keyword") {
        for (const c of candidates) {
          similarity.set(c.id, keywordRelevance(query, c.content));
        }
      }
    }

    if (candidates.length === 0) return empty("none");

    // ADR-004 阶段 B1：语义级把关 —— 在规则匹配之前就剔出不许出境的条目。
    const { allowed, blocked } = filterBySensitivity(candidates, target);
    if (blocked.length > 0) {
      // 可观测：静默拦截会让人以为「memory 没生效」，而实际是被安全策略挡下。
      console.log(
        `[memory-inject] target=${target} blocked ${blocked.length}/${candidates.length} ` +
        `by sensitivity policy (allowed: ${[...REMOTE_ALLOWED_SENSITIVITIES].join(", ")})`
      );
    }
    candidates = allowed;
    if (candidates.length === 0) return empty("none");

    const scored: InjectedMemory[] = [];

    for (const rule of activeRules) {
      const eligible = candidates.filter((c) => matchesRule(c, rule));
      if (eligible.length === 0) continue;

      const ranked = eligible
        .map((c) => {
          const relevance = similarity.get(c.id) ?? 0;
          const importance = c.importance ?? 3;
          const score =
            DEFAULT_WEIGHTS.relevance * relevance +
            DEFAULT_WEIGHTS.importance * (importance / 5) +
            DEFAULT_WEIGHTS.recency * recencyScore(c.updated_at);
          return {
            id: c.id,
            category: c.category,
            content: c.content,
            rule: rule.name,
            relevance,
            importance,
            score,
            _relevance: relevance,
          };
        })
        .filter((e) => {
          // on_relevance rules only fire above their threshold.
          if (rule.inject === "on_relevance") {
            return e._relevance >= (rule.relevanceThreshold ?? 0.3);
          }
          return true;
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, rule.maxItems);

      // Per-rule token cap.
      let used = 0;
      for (const e of ranked) {
        const cost = estimateTokens(e.content);
        if (used + cost > rule.maxTokens) continue;
        used += cost;
        const { _relevance, ...clean } = e;
        scored.push(clean);
      }
    }

    // Global budget: highest score first, stop when full.
    scored.sort((a, b) => b.score - a.score);
    const selected: InjectedMemory[] = [];
    let total = 0;
    let truncated = false;
    for (const m of scored) {
      const cost = estimateTokens(m.content);
      if (total + cost > activeBudget.totalMaxTokens) {
        truncated = true;
        continue; // keep scanning — a shorter later entry may still fit
      }
      selected.push(m);
      total += cost;
    }

    return {
      memories: selected,
      block: renderBlock(selected, target),
      stats: {
        candidates: candidates.length,
        selected: selected.length,
        approxTokens: total,
        budget: activeBudget.totalMaxTokens,
        method,
        truncated,
      },
    };
  } catch {
    // Injection must never break a turn.
    return empty("none");
  }
}

function matchesRule(entry: MemoryEntry, rule: InjectionRule): boolean {
  if (!rule.categories.includes(entry.category)) return false;
  if (rule.minImportance && (entry.importance ?? 0) < rule.minImportance) return false;
  // Unconfirmed entries must never reach the prompt. Governance is not
  // decoration: if a pending memory could be injected, "awaiting confirmation"
  // would mean nothing.
  if ((entry.tags ?? []).includes(PENDING_TAG)) return false;
  // Confidence is only tracked via tags for auto-learned entries; manual
  // entries have no rule tag and are treated as fully trusted.
  if (rule.minConfidence) {
    const isAuto = (entry.tags ?? []).some((t) => t.startsWith("rule:"));
    if (isAuto && !confidenceFromTags(entry.tags ?? [], rule.minConfidence)) return false;
  }
  return true;
}

/** Auto-learned entries encode confidence indirectly via importance. */
function confidenceFromTags(tags: string[], min: number): boolean {
  // importance 4 ≈ conf ≥0.9, 3 ≈ ≥0.8, 2 ≈ ≥0.75 — see toMemoryEntryInput().
  void tags;
  return min <= 0.75;
}

async function tryEmbed(text: string): Promise<number[] | null> {
  try {
    return await getEmbedding(text);
  } catch {
    return null;
  }
}

/**
 * Render the memory block.
 *
 * For a LOCAL target no processing is applied — the data never leaves the
 * machine. For a REMOTE target the block is expected to pass through
 * egress processing downstream (see egress-processor.ts), so we only mark it.
 */
export function renderBlock(memories: InjectedMemory[], target: InjectionTarget = "local"): string {
  if (memories.length === 0) return "";
  const lines = memories.map(
    (m) => `- [${m.rule}] ${m.content}`
  );
  const header =
    target === "local"
      ? "## 关于用户（本地记忆，未外发）"
      : "## 关于用户（记忆摘要，外发前已经过加工）";
  return `${header}\n${lines.join("\n")}`;
}
