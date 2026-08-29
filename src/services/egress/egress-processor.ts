/**
 * Egress Processing Pipeline (ADR-001)
 * =====================================
 *
 * 新护栏（Boss 决策 2026-08-29）：
 *   入 —— 本地优先，原始 prompt 存本机
 *   出 —— 发往云端的内容**必须加工**
 *
 * 本模块是「出」这一侧的唯一执行点。所有发往云端 LLM 的 messages
 * 在离开进程前必须经过 processEgress()。
 *
 * 设计约束：
 * - **模式匹配，非语义 DLP**（ADR-001 §3 保留 TRST-0.3「无语义 DLP」护栏）
 *   只用正则识别密钥 / PII 等结构化敏感串，不使用模型判断语义。
 * - **加工可观测**：统计命中类型与数量，**绝不记录原文**（ADR-001 §5.4）。
 * - **默认安全**：默认 standard 级别；关闭需显式配置。
 * - **可逆性不做保证**：脱敏是单向的，占位符不含任何原文片段。
 */

import type { ChatMessage } from "../../types/index.js";

// ── Policy ──────────────────────────────────────────────────────────────────

export type EgressLevel = "off" | "minimal" | "standard" | "strict";

export interface EgressPolicy {
  level: EgressLevel;
  /** 脱敏密钥类（API key / token / 私钥） */
  redactSecrets: boolean;
  /** 脱敏 PII（邮箱 / 手机 / 身份证 / 银行卡） */
  redactPII: boolean;
  /** 保留的最大历史轮次（超出部分从最早开始丢弃） */
  maxHistoryTurns: number;
  /** 单条消息最大字符数（超出截断） */
  maxMessageChars: number;
}

const DEFAULT_POLICY: EgressPolicy = {
  level: "standard",
  redactSecrets: true,
  redactPII: true,
  maxHistoryTurns: 6,
  maxMessageChars: 12000,
};

const PRESETS: Record<EgressLevel, EgressPolicy> = {
  off: { level: "off", redactSecrets: false, redactPII: false, maxHistoryTurns: 999, maxMessageChars: Number.MAX_SAFE_INTEGER },
  minimal: { level: "minimal", redactSecrets: true, redactPII: false, maxHistoryTurns: 12, maxMessageChars: 30000 },
  standard: DEFAULT_POLICY,
  strict: { level: "strict", redactSecrets: true, redactPII: true, maxHistoryTurns: 3, maxMessageChars: 4000 },
};

/** Resolve the active policy from env, defaulting to standard (safe default). */
export function getEgressPolicy(): EgressPolicy {
  const raw = (process.env.TRUSTOS_EGRESS_LEVEL ?? "standard").toLowerCase();
  if (raw in PRESETS) return { ...PRESETS[raw as EgressLevel] };
  return { ...DEFAULT_POLICY };
}

// ── Sensitive patterns (regex only — no semantic/DLP model) ─────────────────

interface Pattern {
  type: string;
  re: RegExp;
  /**
   * Optional validator for ambiguous rules. Receives the full match and the
   * first capture group (the candidate value). Return false to leave the
   * match untouched — avoids corrupting legitimate content.
   */
  validate?: (full: string, captured: string) => boolean;
}

/**
 * `key: value` assignment rule.
 *
 * This is the one pattern with real false-positive risk: it also matches
 * ordinary declarations like `interface Config { apiKey: string }` or
 * `password: <input>`. Redacting those silently corrupts the outbound prompt
 * (e.g. breaking a JSON schema the model is asked to follow), which is worse
 * than missing a secret. So the captured value is validated before replacing.
 */
const ASSIGNED_SECRET_RE =
  /\b(?:api[_-]?key|secret|password|passwd|pwd|access[_-]?token|refresh[_-]?token)\b\s*[:=]\s*["']?([^\s"',;]{4,})/gi;

/** Type keywords and placeholders that must never be treated as a secret. */
const NOT_A_SECRET = new Set([
  "string", "number", "boolean", "bool", "any", "unknown", "never", "void",
  "object", "array", "int", "float", "double", "str", "none", "null",
  "undefined", "true", "false", "input", "text", "value", "required",
  "optional", "your", "here", "placeholder", "example", "todo", "fixme",
]);

function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (v.length < 8) return false;
  // Template / angle placeholders: ${ENV}, <your-key>
  if (/^[$<{]/.test(v)) return false;
  // Known type / placeholder keyword
  if (NOT_A_SECRET.has(v.toLowerCase())) return false;
  // A bare lowercase word is likely a variable or type name; only treat long
  // ones as secrets (e.g. "hunter2supersecret").
  if (/^[A-Za-z]+$/.test(v) && !/[A-Z]/.test(v.slice(1)) && v.length < 12) {
    return false;
  }
  return true;
}

/**
 * Order matters: more specific patterns first, so a private key block is not
 * partially matched by a generic "token" rule.
 */
const SECRET_PATTERNS: Pattern[] = [
  { type: "PRIVATE_KEY", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g },
  // ANTHROPIC_KEY must precede OPENAI_KEY: "sk-ant-…" also satisfies the
  // generic "sk-" pattern, so the more specific rule has to run first.
  { type: "ANTHROPIC_KEY", re: /sk-ant-[A-Za-z0-9_-]{16,}/g },
  { type: "OPENAI_KEY", re: /sk-[A-Za-z0-9_-]{16,}/g },
  { type: "BEARER", re: /Bearer\s+[A-Za-z0-9._~+/=-]{12,}/gi },
  { type: "JWT", re: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },
  // Ambiguous — validated per match to avoid mangling code/schema.
  { type: "ASSIGNED_SECRET", re: ASSIGNED_SECRET_RE, validate: (_full, captured) => looksLikeSecret(captured) },
];

const PII_PATTERNS: Pattern[] = [
  { type: "EMAIL", re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g },
  // CN mobile
  { type: "PHONE_CN", re: /\b1[3-9]\d{9}\b/g },
  // CN ID card (18 digits, possibly ending in X)
  { type: "ID_CN", re: /\b\d{17}[\dXx]\b/g },
  // Payment card (13-19 digits, allow separators)
  { type: "CARD", re: /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/g },
];

// ── Stats (metadata only — never the matched text) ──────────────────────────

export interface EgressStats {
  level: EgressLevel;
  messages_in: number;
  messages_out: number;
  chars_in: number;
  chars_out: number;
  /** hit count keyed by pattern type, e.g. { EMAIL: 2 } */
  redactions: Record<string, number>;
  history_turns_dropped: number;
  messages_truncated: number;
  duration_ms: number;
}

interface RedactResult {
  text: string;
  hits: Record<string, number>;
}

function redact(text: string, patterns: Pattern[]): RedactResult {
  const hits: Record<string, number> = {};
  let out = text;
  for (const p of patterns) {
    if (p.validate) {
      // Ambiguous rule: validate each match before replacing it.
      p.re.lastIndex = 0;
      out = out.replace(p.re, (full: string, captured: string) => {
        if (!p.validate!(full, captured ?? "")) return full; // keep original
        hits[p.type] = (hits[p.type] ?? 0) + 1;
        return `[REDACTED:${p.type}]`;
      });
      continue;
    }
    // Reset lastIndex: module-level regexes with /g are stateful.
    p.re.lastIndex = 0;
    out = out.replace(p.re, () => {
      hits[p.type] = (hits[p.type] ?? 0) + 1;
      // Placeholder carries the TYPE only — no fragment of the original.
      return `[REDACTED:${p.type}]`;
    });
  }
  return { text: out, hits };
}

function mergeHits(target: Record<string, number>, src: Record<string, number>): void {
  for (const [k, v] of Object.entries(src)) {
    target[k] = (target[k] ?? 0) + v;
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface EgressResult {
  messages: ChatMessage[];
  stats: EgressStats;
}

/**
 * Process outbound messages before they leave the machine.
 *
 * Pipeline: history trimming → truncation → secret redaction → PII redaction.
 * Order is deliberate: reduce volume first, then redact what remains.
 */
export function processEgress(
  messages: ChatMessage[],
  policy: EgressPolicy = getEgressPolicy(),
): EgressResult {
  const startedAt = Date.now();
  const redactions: Record<string, number> = {};
  const charsIn = messages.reduce((n, m) => n + (m.content?.length ?? 0), 0);

  if (policy.level === "off") {
    return {
      messages,
      stats: {
        level: "off",
        messages_in: messages.length,
        messages_out: messages.length,
        chars_in: charsIn,
        chars_out: charsIn,
        redactions,
        history_turns_dropped: 0,
        messages_truncated: 0,
        duration_ms: Date.now() - startedAt,
      },
    };
  }

  // ① Trim history: keep the system prompt + the most recent N turns.
  const system = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");
  const turnsToKeep = Math.max(1, policy.maxHistoryTurns);
  const kept = nonSystem.slice(-turnsToKeep);
  const historyTurnsDropped = nonSystem.length - kept.length;

  let messagesTruncated = 0;

  // ② Truncate + ③ redact
  const processed: ChatMessage[] = [...system, ...kept].map((m) => {
    let text = m.content ?? "";

    if (text.length > policy.maxMessageChars) {
      text = text.slice(0, policy.maxMessageChars) + "\n…[TRUNCATED]";
      messagesTruncated++;
    }

    if (policy.redactSecrets) {
      const r = redact(text, SECRET_PATTERNS);
      text = r.text;
      mergeHits(redactions, r.hits);
    }
    if (policy.redactPII) {
      const r = redact(text, PII_PATTERNS);
      text = r.text;
      mergeHits(redactions, r.hits);
    }

    return { ...m, content: text };
  });

  const charsOut = processed.reduce((n, m) => n + (m.content?.length ?? 0), 0);

  return {
    messages: processed,
    stats: {
      level: policy.level,
      messages_in: messages.length,
      messages_out: processed.length,
      chars_in: charsIn,
      chars_out: charsOut,
      redactions,
      history_turns_dropped: historyTurnsDropped,
      messages_truncated: messagesTruncated,
      duration_ms: Date.now() - startedAt,
    },
  };
}

/**
 * Human/ops summary that is safe to log: counts only, never the matched text.
 */
export function describeEgress(stats: EgressStats): string {
  const parts = Object.entries(stats.redactions).map(([k, v]) => `${k}x${v}`);
  const red = parts.length > 0 ? parts.join(",") : "none";
  return (
    `[egress] level=${stats.level} msgs=${stats.messages_in}->${stats.messages_out} ` +
    `chars=${stats.chars_in}->${stats.chars_out} dropped=${stats.history_turns_dropped} ` +
    `truncated=${stats.messages_truncated} redactions=${red} in ${stats.duration_ms}ms`
  );
}
