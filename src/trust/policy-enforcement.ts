/**
 * TRST-4F Policy Enforcement — execution-path integration (v0: BLOCK only).
 *
 * The decision half (TrustPolicyEngine) already exists and is tested. This module
 * is the ACTION half: it is called immediately BEFORE a real upstream LLM call
 * (in model-gateway), computes a decision, and — depending on
 * config.policyEnforcementMode — either blocks the call or merely logs a
 * divergence event (dry-run shadow).
 *
 * Red lines (carried from charter):
 *   - No DLP / no raw-content inspection beyond metadata used for classification.
 *   - Enforcement events carry hashes + labels ONLY; raw payload is NEVER stored.
 *   - fail-open by default: with no matching deny rule, traffic passes (no silent
 *     mass-blocking). Real blocking requires an explicit deny rule to match.
 *
 * Scope (Boss-approved v0): BLOCK (deny) only. Hold / Override / Transform deferred.
 */

import { createHash } from "node:crypto";
import { TrustPolicyEngine, type PolicyCheckRequest, type PolicyCheckResult } from "./policy-engine.js";
import { config } from "../config.js";
import { appendEvent } from "../services/trst1/jsonl-event-store.js";

/** Thrown when a call is actually blocked in live mode. */
export class PolicyBlockedError extends Error {
  readonly decision: PolicyCheckResult;
  constructor(decision: PolicyCheckResult) {
    super(`Policy enforcement blocked this call: ${decision.reason ?? decision.ruleId ?? "deny"}`);
    this.name = "PolicyBlockedError";
    this.decision = decision;
  }
}

/** Result of an enforcement check at the gateway boundary. */
export interface EnforcementOutcome {
  decision: PolicyCheckResult["decision"];
  blocked: boolean;
  mode: "dry_run" | "live";
  ruleId?: string;
  reason?: string;
}

/**
 * Build the engine with fail-open semantics.
 * IMPORTANT: do NOT install an `allow-all` rule with `condition: () => true` —
 * TrustPolicyEngine.check() returns the FIRST matching rule, so a catch-all allow
 * would shadow any deny rule added later. Instead we rely on failOpen:true, which
 * makes "no rule matched" => allow. This guarantees 4F never silently blocks
 * legitimate calls (honesty + safety boundary) while still letting deny rules win.
 */
function buildEngine(): TrustPolicyEngine {
  return new TrustPolicyEngine([], undefined, { failOpen: true, verbose: false });
}

// Single shared engine instance (rules are additive; v0 ships no deny rules,
// so 4F is effectively a shadow logger until Boss adds deny rules / flips live).
const engine = buildEngine();

/** Add a deny rule (operator/Boss-managed; not auto-populated in v0). */
export function addDenyRule(
  id: string,
  description: string,
  condition: (req: PolicyCheckRequest, classification: any) => boolean,
  reason: string,
): void {
  engine.addRule({ id, description, condition, decision: { decision: "deny", reason } });
}

/** Short hash of the request payload — for evidence binding without storing raw. */
function payloadHash(req: PolicyCheckRequest): string {
  const repr = JSON.stringify({ dataType: req.dataType, recipient: req.recipient, source: req.source });
  return createHash("sha256").update(repr).digest("hex");
}

/** Emit a hash-only enforcement event into the Event Backbone. */
function emitEnforcementEvent(
  req: PolicyCheckRequest,
  result: PolicyCheckResult,
  mode: "dry_run" | "live",
  blocked: boolean,
): void {
  try {
    appendEvent({
      event_type: "policy_enforcement",
      timestamp: new Date().toISOString(),
      trace_id: req.sessionId || "unknown",
      session_id: req.sessionId || "unknown",
      run_id: "unknown",
      // hash-only evidence; raw payload is NOT included (red line)
      payload_hash: payloadHash(req),
      decision: result.decision,
      rule_id: result.ruleId ?? "none",
      reason: result.reason ?? "",
      data_type: req.dataType,
      recipient: req.recipient,
      enforcement_mode: mode,
      blocked: blocked ? "true" : "false",
    } as any);
  } catch {
    // Never let enforcement logging break the call path.
  }
}

/**
 * Enforcement checkpoint called before every real upstream LLM call.
 *
 * @returns outcome (always allows the caller to proceed unless live+deny)
 * @throws PolicyBlockedError when mode=live and decision=deny
 */
export function enforceBeforeLlmCall(req: PolicyCheckRequest): EnforcementOutcome {
  const mode = config.policyEnforcementMode;
  const result = engine.check(req);
  const blocked = result.decision === "deny";

  if (blocked) {
    // dry_run: log divergence, but DO NOT block (shadow).
    emitEnforcementEvent(req, result, mode, mode === "live");
    if (mode === "live") {
      throw new PolicyBlockedError(result);
    }
    return { decision: result.decision, blocked: false, mode, ruleId: result.ruleId, reason: result.reason };
  }

  // allow / (transform|ask_user not in v0 scope) — pass through, optionally log.
  if (mode === "live") {
    emitEnforcementEvent(req, result, mode, false);
  }
  return { decision: result.decision, blocked: false, mode, ruleId: result.ruleId };
}

/** Test/diagnostic helper: current mode. */
export function currentEnforcementMode(): "dry_run" | "live" {
  return config.policyEnforcementMode;
}
