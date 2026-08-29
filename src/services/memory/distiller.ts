/**
 * L0 Rule-Based Memory Distiller (RFC-001 Phase 1).
 *
 * Turns a conversation turn into structured memory entries using **no LLM
 * calls at all** — only explicit linguistic signals. This is deliberate:
 *
 * - **Zero cost, zero latency** — runs inline, no provider round-trip.
 * - **High precision** — explicit instructions ("记住…", "以后都…") are
 *   almost never false positives. Low recall is the accepted trade-off:
 *   we would rather miss something than pollute memory with a wrong fact,
 *   because a wrong memory keeps misleading every later turn.
 *
 * Signals handled (all explicit):
 *   instruction — "以后都…" / "每次都…" / "记得…"
 *   preference  — "我喜欢…" / "我偏好…" / "用 X 不要用 Y"
 *   decision    — "我们决定…" / "就按 X 来" / "确定用 X"
 *   constraint  — "不要…" / "别…" / "必须…" / "禁止…"
 *   fact        — "记住…" / "我叫…" / "我的 X 是 Y"
 *
 * Output carries confidence so the caller can route low-confidence items to a
 * pending-review queue instead of activating them directly.
 */

import type { MemoryCategory } from "../../types/index.js";

export interface DistilledMemory {
  category: MemoryCategory;
  content: string;
  /** 0.0–1.0. Below `LOW_CONFIDENCE_THRESHOLD` → pending review. */
  confidence: number;
  tags: string[];
  /** Which rule fired — useful for tuning and debugging. */
  rule: string;
  /** The user's own words, for provenance/audit. */
  evidence: string;
  /**
   * Character span of the matched evidence within the source text.
   * Used for overlap suppression — see suppressOverlaps().
   */
  span: { start: number; end: number };
}

/** Below this, entries go to the pending-review queue rather than going live. */
export const LOW_CONFIDENCE_THRESHOLD = 0.7;

interface Rule {
  name: string;
  category: MemoryCategory;
  /** Applied to the whole (trimmed) turn text. */
  pattern: RegExp;
  /** Confidence when this rule matches. */
  confidence: number;
  /** Build the memory content from the match. */
  extract: (m: RegExpExecArray) => string | null;
  tags?: string[];
}

// ── Rules ───────────────────────────────────────────────────────────────────
// Order matters: the first matching rule wins for a given span, so more
// specific patterns are listed first.

// Capture stops at a sentence boundary so one rule cannot swallow several
// independent signals ("记住用 Redis。以后都用 TS。" must yield TWO entries).
const SENT = "[^。！？；;!?\\n]";

const RULES: Rule[] = [
  // ── Explicit "remember" → fact ────────────────────────────────────────────
  {
    name: "remember",
    category: "fact",
    pattern: new RegExp(`(?:请?记住|记一下|帮我记住|记住了?)\\s*[:：]?\\s*(${SENT}{2,120})`),
    confidence: 0.95,
    extract: (m) => clean(m[1]),
    tags: ["explicit"],
  },
  {
    name: "remember_en",
    category: "fact",
    pattern: new RegExp(`\\b(?:remember|keep in mind|note that)\\s+(${SENT}{3,120})`, "i"),
    confidence: 0.9,
    extract: (m) => clean(m[1]),
    tags: ["explicit"],
  },

  // ── Standing instruction ──────────────────────────────────────────────────
  {
    name: "standing_instruction",
    category: "instruction",
    pattern: new RegExp(`(?:以后(?:都|每次|就)?|每次(?:都)?|今后|从现在开始)\\s*(${SENT}{2,120})`),
    confidence: 0.9,
    extract: (m) => clean(m[1]),
    tags: ["standing"],
  },
  {
    name: "standing_instruction_en",
    category: "instruction",
    pattern: new RegExp(`\\b(?:from now on|always|going forward)\\s+(${SENT}{3,120})`, "i"),
    confidence: 0.85,
    extract: (m) => clean(m[1]),
    tags: ["standing"],
  },

  // ── Preference ────────────────────────────────────────────────────────────
  {
    name: "preference_like",
    category: "preference",
    pattern: new RegExp(`我(?:比较|更|最)?(?:喜欢|偏好|习惯|倾向于?)\\s*(${SENT}{1,80})`),
    confidence: 0.85,
    extract: (m) => clean(m[1]),
    tags: ["preference"],
  },
  {
    name: "preference_over",
    category: "preference",
    pattern: /用\s*([^\s，。,.]{1,30})\s*不要(?:再)?用\s*([^\s，。,.]{1,30})/,
    confidence: 0.9,
    extract: (m) => `使用 ${clean(m[1])}，不使用 ${clean(m[2])}`,
    tags: ["preference", "tooling"],
  },
  {
    name: "preference_en",
    category: "preference",
    pattern: new RegExp(`\\bI (?:prefer|like|usually use)\\s+(${SENT}{2,80})`, "i"),
    confidence: 0.8,
    extract: (m) => clean(m[1]),
    tags: ["preference"],
  },

  // ── Decision ──────────────────────────────────────────────────────────────
  {
    name: "decision",
    category: "fact",
    pattern: new RegExp(`(?:我们?决定|决定(?:了)?|就按|确定用|最终选择)\\s*(${SENT}{2,120})`),
    confidence: 0.85,
    extract: (m) => `决定：${clean(m[1])}`,
    tags: ["decision"],
  },

  // ── Constraint ────────────────────────────────────────────────────────────
  {
    name: "constraint_prohibit",
    category: "instruction",
    pattern: new RegExp(`(?:不要|别|禁止|绝不能|不可以)\\s*(${SENT}{2,100})`),
    confidence: 0.8,
    extract: (m) => `约束：不要${clean(m[1])}`,
    tags: ["constraint"],
  },
  {
    name: "constraint_require",
    category: "instruction",
    pattern: new RegExp(`(?:必须|一定要|务必|需要确保)\\s*(${SENT}{2,100})`),
    confidence: 0.8,
    extract: (m) => `约束：必须${clean(m[1])}`,
    tags: ["constraint"],
  },

  // ── Self-description → fact ───────────────────────────────────────────────
  {
    name: "self_name",
    category: "fact",
    pattern: /(?:我叫|我的名字是|我是)\s*([^\s，。,.]{1,30})/,
    confidence: 0.75,
    extract: (m) => `用户称为 ${clean(m[1])}`,
    tags: ["identity"],
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Trim trailing punctuation and whitespace; collapse internal spaces. */
function clean(text: string | undefined): string | null {
  if (!text) return null;
  const out = text
    .replace(/[。．.!！?？；;]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return out.length >= 2 ? out : null;
}

/** Guard: refuse to distil turns that look like secrets or code. */
const SENSITIVE_RE =
  /(sk-[A-Za-z0-9_-]{16,}|Bearer\s+\S{12,}|password\s*[:=]|api[_-]?key\s*[:=]|-----BEGIN)/i;

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Distil memory entries from a single turn.
 *
 * Returns `[]` when no explicit signal is present — silence is the correct
 * default (a wrong memory is worse than none).
 */
export function distilTurn(text: string): DistilledMemory[] {
  if (!text || !text.trim()) return [];

  // Never distil a turn carrying credentials.
  if (SENSITIVE_RE.test(text)) return [];

  const results: DistilledMemory[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    const re = new RegExp(rule.pattern.source, rule.pattern.flags);
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const content = rule.extract(m);
      if (content && !seen.has(content)) {
        seen.add(content);
        const evidence = (m[0] ?? "").trim();
        results.push({
          category: rule.category,
          content,
          confidence: rule.confidence,
          tags: rule.tags ?? [],
          rule: rule.name,
          evidence: evidence.slice(0, 200),
          span: { start: m.index, end: m.index + (m[0]?.length ?? 0) },
        });
      }
      // Non-global regexes would loop forever on a zero-length match.
      if (m.index === re.lastIndex) re.lastIndex++;
      if (!rule.pattern.flags.includes("g")) break;
    }
  }

  return suppressOverlaps(results);
}

/**
 * Keep only non-overlapping extractions, preferring the most complete match.
 *
 * Why this exists: several rules can fire on the same span.
 * "以后都用 pnpm 不要再用 npm" matches standing_instruction (whole sentence),
 * preference_over ("用 pnpm 不要再用 npm") and constraint_prohibit
 * ("不要再用 npm") — three entries expressing ONE fact. Storing all of them
 * bloats retrieval and wastes prompt tokens on redundant context.
 *
 * Strategy: sort by evidence length (most complete first), then greedily keep
 * entries whose span does not overlap an already-kept span.
 */
function suppressOverlaps(entries: DistilledMemory[]): DistilledMemory[] {
  if (entries.length <= 1) return entries;

  const sorted = [...entries].sort((a, b) => {
    const lenA = a.span.end - a.span.start;
    const lenB = b.span.end - b.span.start;
    // Longer evidence first; ties broken by higher confidence.
    return lenB - lenA || b.confidence - a.confidence;
  });

  const kept: DistilledMemory[] = [];
  for (const candidate of sorted) {
    const overlaps = kept.some(
      (k) => candidate.span.start < k.span.end && k.span.start < candidate.span.end
    );
    if (!overlaps) kept.push(candidate);
  }

  // Restore source order for stable, readable output.
  return kept.sort((a, b) => a.span.start - b.span.start);
}

/** Split into entries that can go live vs. those needing user confirmation. */
export function partitionByConfidence(entries: DistilledMemory[]): {
  active: DistilledMemory[];
  pending: DistilledMemory[];
} {
  const active: DistilledMemory[] = [];
  const pending: DistilledMemory[] = [];
  for (const e of entries) {
    (e.confidence >= LOW_CONFIDENCE_THRESHOLD ? active : pending).push(e);
  }
  return { active, pending };
}

/**
 * Convert a distilled entry into the shape `MemoryEntryRepo.create` expects.
 * Source is `auto_learn`; provenance is preserved in tags so any auto-extracted
 * memory can be traced back to the conversation that produced it.
 */
export function toMemoryEntryInput(
  entry: DistilledMemory,
  userId: string,
  provenanceRef?: string
): {
  user_id: string;
  category: MemoryCategory;
  content: string;
  importance: number;
  tags: string[];
  source: "auto_learn";
} {
  // Importance scales with confidence: high-confidence explicit signals matter
  // more, but auto-learned entries never outrank a user's manual entry.
  const importance = entry.confidence >= 0.9 ? 4 : entry.confidence >= 0.8 ? 3 : 2;
  const tags = [...entry.tags, `rule:${entry.rule}`];
  if (provenanceRef) tags.push(`turn:${provenanceRef}`);

  return {
    user_id: userId,
    category: entry.category,
    content: entry.content,
    importance,
    tags,
    source: "auto_learn",
  };
}
