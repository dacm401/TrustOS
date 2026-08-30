/**
 * Shared text similarity utilities.
 *
 * Extracted so multiple features (memory injection, delegation-archive
 * replay) use ONE implementation instead of each growing its own.
 *
 * Design notes:
 * - No external segmentation library. Chinese has no spaces, so a whole
 *   clause would otherwise become a single token and never match a substring
 *   ("测试框架" vs "测试框架是 Vitest" would score 0). CJK runs are split
 *   into bigrams — the standard approach for Chinese lexical retrieval.
 * - Pure functions, zero I/O, trivially testable.
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/;

/** Split CJK runs into bigrams; keep latin words >= 2 chars. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  const segments = (text ?? "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  for (const seg of segments) {
    if (!CJK_RE.test(seg)) {
      if (seg.length >= 2) out.push(seg);
      continue;
    }
    // Mixed CJK/latin (e.g. "用typescript") → split into runs.
    const runs =
      seg.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]+|[^\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]+/g) ?? [];
    for (const run of runs) {
      if (!CJK_RE.test(run)) {
        if (run.length >= 2) out.push(run);
        continue;
      }
      if (run.length === 1) {
        out.push(run);
      } else {
        for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
      }
    }
  }
  return out;
}

/**
 * Keyword overlap in [0,1].
 * Asymmetric by design: fraction of the QUERY's tokens found in the text.
 * A short query fully contained in a long text scores 1.0, which is what
 * "does this archive entry answer this question?" wants.
 */
export function keywordRelevance(query: string, text: string): number {
  const q = new Set(tokenize(query));
  const t = new Set(tokenize(text));
  if (q.size === 0 || t.size === 0) return 0;
  let hits = 0;
  for (const w of q) if (t.has(w)) hits++;
  return hits / q.size;
}

/**
 * Symmetric similarity (Jaccard) — use when both sides are comparable
 * lengths (e.g. matching two questions against each other).
 */
export function jaccardSimilarity(a: string, b: string): number {
  const sa = new Set(tokenize(a));
  const sb = new Set(tokenize(b));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/**
 * Time-sensitive phrases. Archive replay must NOT answer these from history —
 * "今天天气怎么样" asked yesterday has a different correct answer today.
 */
const TIME_SENSITIVE_RE =
  /(今天|明天|昨天|现在|此刻|当前|最新|刚刚|实时|几点|日期|天气|股价|价格|汇率|余额|剩余|还有多少|多少度|新闻)/;

export function isTimeSensitive(text: string): boolean {
  return TIME_SENSITIVE_RE.test(text ?? "");
}

/** Rough token estimate: CJK ≈ 1.5 tokens/char, latin ≈ 0.25. */
export function estimateTokens(text: string): number {
  let tokens = 0;
  for (const ch of text) {
    tokens += /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff]/.test(ch) ? 1.5 : 0.25;
  }
  return Math.ceil(tokens);
}
