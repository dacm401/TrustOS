// MWT-7 — Validation status taxonomy + overall readiness semantics.
//
// Single, explicit classification used by the aggregator (run-validation.mts)
// and the health scripts. The contract is honest:
//   - PASS          : step ran and succeeded
//   - FAIL          : step ran and a real assertion/condition failed
//   - ENV_BLOCKED   : step could not run because an ENVIRONMENT dependency is
//                     missing (DB / LLM gateway / network), NOT a code defect
//   - SKIPPED       : optional step intentionally disabled (e.g., not relevant
//                     to this environment)
//
// Hard rules (PM):
//   - ENV_BLOCKED must NEVER be counted as PASS.
//   - ENV_BLOCKED is NOT an ordinary FAIL (it is reported separately and does
//     not by itself indicate a regression).
//   - Any true FAIL forces overall = FAIL.

export type ValidationStatus = "PASS" | "FAIL" | "ENV_BLOCKED" | "SKIPPED";

export type OverallReadiness =
  | "READY"
  | "READY_WITH_ENV_BLOCKERS"
  | "FAIL";

export interface StepOutcome {
  name: string;
  status: ValidationStatus;
  /** Which bucket the step belongs to. Deterministic is the strict bucket. */
  bucket: "deterministic" | "live" | "skipped" | "health";
  detail?: string;
}

export function isPass(s: ValidationStatus): boolean {
  return s === "PASS";
}

export function isEnvBlocked(s: ValidationStatus): boolean {
  return s === "ENV_BLOCKED";
}

export function isFail(s: ValidationStatus): boolean {
  return s === "FAIL";
}

export function isSkipped(s: ValidationStatus): boolean {
  return s === "SKIPPED";
}

/**
 * Compute overall readiness from a list of outcomes.
 *
 *   any FAIL                              => FAIL
 *   no FAIL but any ENV_BLOCKED           => READY_WITH_ENV_BLOCKERS
 *   otherwise (all PASS / SKIPPED)        => READY
 *
 * NOTE: A SKIPPED step never degrades readiness; it is expected/intentional.
 */
export function computeReadiness(outcomes: StepOutcome[]): OverallReadiness {
  const hasFail = outcomes.some((o) => o.status === "FAIL");
  if (hasFail) return "FAIL";

  const hasEnvBlocked = outcomes.some((o) => o.status === "ENV_BLOCKED");
  if (hasEnvBlocked) return "READY_WITH_ENV_BLOCKERS";

  return "READY";
}

export interface BucketTotals {
  pass: number;
  fail: number;
  envBlocked: number;
  skipped: number;
  total: number;
}

/** Summarize a bucket (deterministic / live / skipped / health) by status. */
export function summarize(outcomes: StepOutcome[]): BucketTotals {
  const t: BucketTotals = { pass: 0, fail: 0, envBlocked: 0, skipped: 0, total: outcomes.length };
  for (const o of outcomes) {
    if (o.status === "PASS") t.pass++;
    else if (o.status === "FAIL") t.fail++;
    else if (o.status === "ENV_BLOCKED") t.envBlocked++;
    else if (o.status === "SKIPPED") t.skipped++;
  }
  return t;
}

/** Render a readiness verdict as a short, human line. */
export function renderReadiness(r: OverallReadiness): string {
  switch (r) {
    case "READY":
      return "READY — all deterministic + live passed (skipped optional only)";
    case "READY_WITH_ENV_BLOCKERS":
      return "READY_WITH_ENV_BLOCKERS — no code failures; some live steps blocked by missing environment";
    case "FAIL":
      return "FAIL — at least one real failure; do not ship until resolved";
  }
}
