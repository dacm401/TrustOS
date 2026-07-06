/**
 * S100P-009: Manager Router
 *
 * Deterministic / heuristic routing for Manager Loop messages.
 * Phase 2 does NOT use LLM — only keyword matching and rule-based logic.
 *
 * Routing rules (in priority order):
 *   1. Explicit target_session_id → update_existing_session
 *   2. Delegation intent keywords → new_delegated_task
 *   3. Reference words + unique active session match → update_existing_session
 *   4. Reference words + multiple ambiguous sessions → ambiguous_session_reference
 *   5. Otherwise → normal_conversation
 */

import type {
  ManagerRoutingInput,
  ManagerRoutingResult,
  ActiveSessionSummary,
  SessionEventSuggestion,
  NewSessionSuggestion,
} from "./manager-routing-types.js";

// ── Keyword Sets ─────────────────────────────────────────────────────────────

/** Keywords that indicate the user wants to delegate a new task */
const DELEGATION_KEYWORDS = [
  "帮我", "让Worker", "执行", "修", "生成", "整理", "分析",
  "创建任务", "委托", "跑一下", "帮我做", "帮我修", "帮我生成",
  "帮我整理", "帮我分析", "帮我执行",
];

/** Keywords that indicate the user is referring to an existing task */
const REFERENCE_KEYWORDS = [
  "那个任务", "登录页那个", "刚才那个", "之前那个",
  "那个session", "之前的任务", "上次那个", "这个任务",
  "那个", "刚才的",
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some(kw => text.includes(kw));
}

/**
 * Generate n-gram substrings (length n) from a string.
 * Used for fuzzy Chinese title matching — Chinese titles rarely have
 * word delimiters, so we slide a window to extract char-grams.
 */
function nGrams(text: string, n: number): string[] {
  if (text.length < n) return [text];
  const grams: string[] = [];
  for (let i = 0; i <= text.length - n; i++) {
    grams.push(text.substring(i, i + n));
  }
  return grams;
}

/**
 * Try to match a reference to a specific active session.
 * Returns the matched session, or null if no unique match.
 *
 * Matching strategy (handles both space/punct-delimited and CJK titles):
 *   1. Split title into chunks by delimiters (spaces, commas, etc.)
 *   2. For chunks of length >= 4: use 3-gram matching with a minimum
 *      hit threshold of floor(chunkLength / 4) to avoid false matches
 *      from short common substrings (e.g. "登录页" matching two sessions).
 *   3. For chunks of length 2-3: check the chunk directly
 */
function matchSessionByReference(
  message: string,
  sessions: ActiveSessionSummary[]
): ActiveSessionSummary | null {
  if (sessions.length === 0) return null;

  const matched: ActiveSessionSummary[] = [];
  for (const session of sessions) {
    if (!session.title) continue;
    const titleChunks = session.title.split(/[\s,，。、]+/).filter(w => w.length >= 2);
    const isMatch = titleChunks.some(chunk => {
      if (chunk.length >= 4) {
        // 3-gram matching with threshold (CJK-friendly, avoids short-common-substring collisions)
        const grams = nGrams(chunk, 3);
        const hitCount = grams.filter(g => message.includes(g)).length;
        const threshold = Math.max(1, Math.floor(chunk.length / 4));
        return hitCount >= threshold;
      }
      // Short chunk: direct substring check
      return message.includes(chunk);
    });
    if (isMatch) {
      matched.push(session);
    }
  }

  if (matched.length === 1) return matched[0];
  return null;
}

/**
 * Generate a short title from a delegation message.
 * Uses the first clause or first N characters.
 */
function generateTitle(message: string): string {
  // Try to extract the first clause before punctuation
  const firstClause = message.split(/[，。,.!！?？\n]/)[0].trim();
  if (firstClause.length > 0 && firstClause.length <= 60) {
    return firstClause;
  }
  // Fallback: first 40 chars
  return message.substring(0, 40).trim() || "Untitled Task";
}

/**
 * Determine risk level based on message content.
 */
function assessRisk(message: string): "low" | "medium" {
  const mediumRiskKeywords = ["删除", "修改数据库", "生产环境", "部署", "上线", "drop", "delete", "migrate"];
  if (containsAny(message.toLowerCase(), mediumRiskKeywords)) {
    return "medium";
  }
  return "low";
}

// ── Main Router ──────────────────────────────────────────────────────────────

export function routeMessage(input: ManagerRoutingInput): ManagerRoutingResult {
  const { user_id, conversation_id, message, target_session_id, active_sessions } = input;

  // Rule 1: Explicit target_session_id → update_existing_session
  if (target_session_id) {
    const targetSession = active_sessions.find(s => s.id === target_session_id);
    if (targetSession) {
      return {
        route_type: "update_existing_session",
        target_session_id: target_session_id,
        clarification_required: false,
        manager_message_content: `已更新「${targetSession.title}」的任务边界：${message}`,
        session_event: {
          type: "session.updated",
          summary: `User updated task boundary: ${message}`,
          visibility: "session_timeline",
          severity: "info",
        },
        created_session: null,
        reason: "Explicit target_session_id provided by user",
      };
    }
    // target_session_id provided but not found in active sessions — fall through
  }

  // Rule 2: Delegation intent keywords → new_delegated_task
  if (containsAny(message, DELEGATION_KEYWORDS)) {
    const title = generateTitle(message);
    const riskLevel = assessRisk(message);

    return {
      route_type: "new_delegated_task",
      target_session_id: null,
      clarification_required: false,
      manager_message_content: `我已创建独立任务「${title}」。它会作为独立 Session 跟踪，后续进展不会混入主对话。`,
      session_event: {
        type: "session.created",
        summary: "Created delegated task from Manager routing.",
        visibility: "session_timeline",
        severity: "info",
      },
      created_session: {
        title: title,
        goal: message,
        status: "planning",
        risk_level: riskLevel,
        delegation_contract: {
          source: "manager_routing",
          original_message: message,
          created_at: new Date().toISOString(),
        },
      },
      reason: `Delegation intent keyword detected in message`,
    };
  }

  // Rule 3 & 4: Reference keywords
  if (containsAny(message, REFERENCE_KEYWORDS)) {
    if (active_sessions.length === 0) {
      // Reference words but no active sessions — treat as normal conversation
      return {
        route_type: "normal_conversation",
        target_session_id: null,
        clarification_required: false,
        manager_message_content: message,
        session_event: null,
        created_session: null,
        reason: "Reference keyword detected but no active sessions exist",
      };
    }

    // Try to match a unique session
    const matched = matchSessionByReference(message, active_sessions);
    if (matched) {
      return {
        route_type: "update_existing_session",
        target_session_id: matched.id,
        clarification_required: false,
        manager_message_content: `已更新「${matched.title}」的任务边界：${message}`,
        session_event: {
          type: "session.updated",
          summary: `User updated task boundary: ${message}`,
          visibility: "session_timeline",
          severity: "info",
        },
        created_session: null,
        reason: `Reference matched unique active session: "${matched.title}"`,
      };
    }

    // Rule 4: Multiple active sessions, ambiguous reference
    if (active_sessions.length > 1) {
      const sessionTitles = active_sessions.map(s => `「${s.title}」`).join("还是");
      return {
        route_type: "ambiguous_session_reference",
        target_session_id: null,
        clarification_required: true,
        manager_message_content: `你是指${sessionTitles}？`,
        session_event: null,
        created_session: null,
        reason: "Reference keyword detected but multiple active sessions, no unique match",
      };
    }
  }

  // Rule 5: Normal conversation
  return {
    route_type: "normal_conversation",
    target_session_id: null,
    clarification_required: false,
    manager_message_content: message,
    session_event: null,
    created_session: null,
    reason: "No delegation intent or session reference detected",
  };
}
