/**
 * S85P: Simple Task Classifier V0
 *
 * Conservative decision engine: classifies tasks as eligible or ineligible
 * for the fast path (skip cycle runtime, single Worker LLM call).
 *
 * Design principles:
 * - Better to reject a simple task than to fast-path a risky one.
 * - All checks are local, deterministic, zero LLM calls.
 * - Eligibility is falsifiable: one veto → ineligible.
 */

import type {
  SimpleTaskClassification,
  SimpleTaskClassifierInput,
  SimpleTaskReasonCode,
} from "../types/simple-task-classifier.js";
import {
  S85P_DEFAULTS,
  HIGH_RISK_KEYWORDS,
  SECURITY_COMPLIANCE_KEYWORDS,
  HUMAN_REVIEW_SIGNALS,
} from "../types/simple-task-classifier.js";

// ── Helpers ──────────────────────────────────────────────────────────────

function textContainsAny(text: string, keywords: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw.toLowerCase()));
}

function totalPromptLength(input: SimpleTaskClassifierInput): number {
  let len = (input.taskBrief ?? "").length;
  len += (input.goal ?? "").length;
  if (input.constraints) {
    len += input.constraints.join(" ").length;
  }
  if (input.sections) {
    len += input.sections.join(" ").length;
  }
  return len;
}

function totalSections(input: SimpleTaskClassifierInput): number {
  return (input.sections?.length ?? 0) + (input.constraints?.length ?? 0);
}

function makeResult(
  eligible: boolean,
  reasonCode: SimpleTaskReasonCode,
  reason: string
): SimpleTaskClassification {
  return { eligible, reasonCode, reason };
}

// ── Main Classifier ──────────────────────────────────────────────────────

/**
 * Classify a task for fast path eligibility.
 *
 * Checks are ordered from cheapest to most expensive.
 * The first disqualifying check returns immediately.
 */
export function classifySimpleTask(
  input: SimpleTaskClassifierInput
): SimpleTaskClassification {
  const maxLength = input.maxPromptLength ?? S85P_DEFAULTS.MAX_PROMPT_LENGTH;
  const maxCriteria = input.maxSimpleCriteria ?? S85P_DEFAULTS.MAX_SIMPLE_CRITERIA;

  const combinedText = [
    input.taskBrief ?? "",
    input.goal ?? "",
    ...(input.constraints ?? []),
    ...(input.sections ?? []),
  ].join(" ");

  // ── 1. Tool calls ────────────────────────────────────────────────────
  if (input.hasToolCalls === true) {
    return makeResult(false, "has_tool_calls", "Task requires tool calls, ineligible for fast path.");
  }

  // ── 2. External side effects ─────────────────────────────────────────
  if (input.hasExternalSideEffects === true) {
    return makeResult(false, "has_external_side_effects", "Task has external side effects, ineligible for fast path.");
  }

  // ── 3. Revision task ─────────────────────────────────────────────────
  if (input.isRevisionTask === true) {
    return makeResult(false, "is_revision_task", "Revision tasks require full verification, ineligible for fast path.");
  }

  // ── 4. Prompt length ─────────────────────────────────────────────────
  const promptLen = totalPromptLength(input);
  if (promptLen > maxLength) {
    return makeResult(false, "prompt_too_long", `Prompt length ${promptLen} exceeds max ${maxLength}, ineligible for fast path.`);
  }

  // ── 5. Verification criteria — V0: any criteria disqualifies ─────────
  // S85P V0 uses the most conservative rule: zero criteria allowed.
  // Any sections or constraints imply verification requirements that
  // should not be skipped. S86P may relax this with simple-criteria classification.
  const sectionCount = totalSections(input);
  if (sectionCount > maxCriteria) {
    return makeResult(false, "has_verification_criteria", `Task has ${sectionCount} verification criteria (max ${maxCriteria} allowed in V0), ineligible for fast path.`);
  }

  // ── 6. High-risk keywords ────────────────────────────────────────────
  if (textContainsAny(combinedText, HIGH_RISK_KEYWORDS)) {
    return makeResult(false, "high_risk_keyword", "Task contains high-risk keywords, ineligible for fast path.");
  }

  // ── 7. Security/compliance keywords ──────────────────────────────────
  if (textContainsAny(combinedText, SECURITY_COMPLIANCE_KEYWORDS)) {
    return makeResult(false, "security_compliance_keyword", "Task contains security/compliance keywords, ineligible for fast path.");
  }

  // ── 8. Human review signals ──────────────────────────────────────────
  if (textContainsAny(combinedText, HUMAN_REVIEW_SIGNALS)) {
    return makeResult(false, "requires_human_review", "Task requires human review, ineligible for fast path.");
  }

  // ── All checks passed → eligible ─────────────────────────────────────
  return makeResult(true, "simple_no_tool_low_risk", "Simple task with no tools, low risk, eligible for fast path.");
}
