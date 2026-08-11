/**
 * TRST-4H — Manager Routing Intelligence v0
 *
 * A minimal hybrid routing classifier that sits ABOVE the existing
 * deterministic `manager-router.ts` (S100P). It does NOT modify the sealed
 * Manager Router behavior; it provides a fast intent pre-classification so a
 * caller can decide whether to:
 *   1. delegate to a Worker (route: "delegate")
 *   2. answer normally (route: "normal")
 *   3. ask for clarification (route: "ask_clarification")
 *
 * Design constraints (PM-authorized TRST-4H scope):
 *   - keyword fast-path is preserved and remains the highest-priority signal
 *   - classifier fallback only triggers on keyword misses
 *   - classifier MUST be deterministic (no LLM, no randomness) for tests
 *   - no new dependency
 *   - no backend persistence / schema / policy / enforcement
 *   - sealed MWT-4B (export) and MWT-5 (approval) are NOT touched
 *
 * This is advisory execution logic — NOT evidence, proof, or policy enforcement.
 */

export type ManagerRoutingIntentRoute =
  | "delegate"
  | "normal"
  | "ask_clarification";

export type ManagerRoutingIntentSource = "keyword" | "heuristic";

export interface ManagerRoutingIntent {
  /** The recommended routing decision for this message. */
  route: ManagerRoutingIntentRoute;
  /** Deterministic 0..1 confidence from the matched rule. */
  confidence: number;
  /** Human-readable reason for the decision (advisory, not user-facing proof). */
  reason: string;
  /** Which layer produced the decision. */
  source: ManagerRoutingIntentSource;
}

// ── Keyword fast-path sets ────────────────────────────────────────────────────
// Independent of manager-router.ts so sealed routing is never mutated.
// Strong delegation signals: explicit task/creation/problem-solving verbs.
const DELEGATE_KEYWORDS = [
  "帮我", "让worker", "执行", "修", "生成", "整理", "分析",
  "创建任务", "委托", "跑一下", "帮我做", "帮我修", "帮我生成",
  "帮我整理", "帮我分析", "帮我执行",
  "创建", "写一个", "做一个", "画一个", "写个", "做个",
  "计算", "算出", "求解", "证明", "推导", "解题", "解答",
  "拼出", "运算", "24点", "算24",
  "设计", "实现", "开发", "翻译",
  // TRST-4H: broaden problem-solving / planning phrasing that keyword-only
  // routing historically missed.
  "设计方案", "设计一个方案", "制定方案", "规划", "评估", "研究",
  "帮我看看", "帮我分析一下", "帮我研究", "请分析", "请设计",
  "求解下面的问题", "下面的问题", "这个问题", "这道题", "这个方案",
];

// Strong clarification signals: the user is clearly under-specified.
const CLARIFICATION_KEYWORDS = [
  "什么意思", "不太明白", "不清楚", "不确定", "你能详细", "请说明",
  "解释一下", "具体来说", "怎么弄", "怎么办啊",
];

// Heuristic delegation cues used only when no keyword matches.
const HEURISTIC_DELEGATE_CUES = [
  "分析", "评估", "比较", "预测", "研究", "设计", "方案", "规划",
  "实现", "开发", "构建", "优化", "总结", "报告", "解决", "求解",
  "问题", "算法", "代码", "程序", "函数", "文档", "数据", "图表",
  "流程", "系统", "架构", "策略",
];

// Heuristic normal cues: casual / social / trivial.
const HEURISTIC_NORMAL_CUES = [
  "你好", "您好", "谢谢", "感谢", "哈哈", "在吗", "今天天气",
  "辛苦了", "加油", "早安", "晚安", "好的", "可以", "行",
];

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some((kw) => text.includes(kw));
}

/**
 * Classify a user message into a Manager routing intent.
 *
 * Priority:
 *   1. delegation keyword fast-path  → delegate (source: keyword)
 *   2. clarification keyword fast-path → ask_clarification (source: keyword)
 *   3. heuristic fallback:
 *      - underspecified / pure question without task cues → ask_clarification
 *      - contains task/problem-solving cues or is substantive → delegate
 *      - casual / short / social → normal
 *
 * Deterministic: same input always yields the same output.
 */
export function classifyManagerIntent(message: string): ManagerRoutingIntent {
  const msg = (message ?? "").trim();

  // 1. Delegation keyword fast-path.
  if (containsAny(msg, DELEGATE_KEYWORDS)) {
    return {
      route: "delegate",
      confidence: 0.95,
      reason: "Delegation keyword fast-path matched",
      source: "keyword",
    };
  }

  // 2. Clarification keyword fast-path.
  if (containsAny(msg, CLARIFICATION_KEYWORDS)) {
    return {
      route: "ask_clarification",
      confidence: 0.9,
      reason: "Clarification keyword fast-path matched",
      source: "keyword",
    };
  }

  // 3. Heuristic fallback (keyword path uncertain).
  const lower = msg.toLowerCase();

  // Underspecified: a question mark with little content and no task cues.
  const isQuestionMark = /[?？]$/.test(msg) || msg.includes("？") || msg.includes("?");
  const hasTaskCue = containsAny(msg, HEURISTIC_DELEGATE_CUES);
  const cueScore = HEURISTIC_DELEGATE_CUES.filter((c) => msg.includes(c)).length;

  // Strong social / casual → normal.
  if (containsAny(msg, HEURISTIC_NORMAL_CUES) && !hasTaskCue && msg.length <= 20) {
    return {
      route: "normal",
      confidence: 0.8,
      reason: "Casual/social message without task cues",
      source: "heuristic",
    };
  }

  // Explicit question mark but no task cue and very short → likely needs clarification.
  if (isQuestionMark && !hasTaskCue && msg.length <= 30) {
    return {
      route: "ask_clarification",
      confidence: 0.75,
      reason: "Question without task cues; likely under-specified",
      source: "heuristic",
    };
  }

  // Substantive content with task/problem-solving cues → delegate.
  if (cueScore >= 1 || (hasTaskCue && msg.length > 10)) {
    const confidence = Math.min(0.6 + cueScore * 0.1, 0.9);
    return {
      route: "delegate",
      confidence,
      reason: `Heuristic task/problem-solving cues detected (score ${cueScore})`,
      source: "heuristic",
    };
  }

  // Longer free-form message without clear social cue → lean delegate
  // (better to surface a Worker path than silently fail as normal chat).
  if (msg.length > 40) {
    return {
      route: "delegate",
      confidence: 0.6,
      reason: "Substantive message; default to delegate over silent normal failure",
      source: "heuristic",
    };
  }

  // Default: treat as normal conversation.
  return {
    route: "normal",
    confidence: 0.7,
    reason: "No delegation/clarification signal detected",
    source: "heuristic",
  };
}
