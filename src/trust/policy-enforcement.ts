/**
 * TRST-4F Policy Enforcement — execution-path integration (v0: BLOCK only).
 *
 * The decision half (TrustPolicyEngine) already exists and is tested. This module
 * is the ACTION half: it is called immediately BEFORE a real upstream LLM call
 * (in model-gateway), computes a decision, and — depending on
 * config.policyEnforcementMode — either blocks the call or merely logs a
 * divergence event (dry-run shadow).
 *
 * 2026-08-20 竞争力优先重新规划：4F 是企业买家最看重的防护力（能否真挡住
 * 敏感数据出域）。真实拦截（live）作为可选企业能力提供，shipping off by default。
 *
 * Guardrails retained (not cancelled):
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
import { DEFAULT_POLICY_RULES } from "./policy-rules.js";
import { addEnforcementEventHash } from "./evidence-anchor.js";

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
 * 4E v0 (2026-08-20): attribution metadata for a governance action.
 * Reuses local-identity concepts but does NOT introduce a key store.
 * fingerprint is optional — populated only when caller supplies a local
 * identity descriptor; default (X-User-Id) records userId only.
 */
export interface SignerIdentity {
  user_id: string;
  public_key_fingerprint?: string;
}

/**
 * Build the engine with fail-open semantics.
 * IMPORTANT: do NOT install an `allow-all` rule with `condition: () => true` —
 * TrustPolicyEngine.check() returns the FIRST matching rule, so a catch-all allow
 * would shadow any deny rule added later. Instead we rely on failOpen:true, which
 * makes "no rule matched" => allow. This guarantees 4F never silently blocks
 * legitimate calls (honesty + safety boundary) while still letting deny rules win.
 *
 * 竞争力优先（2026-08-20）：模式 DLP 是企业防护力卖点（原名 R1 "No DLP" 已让路）。
 * 当 config.permission.dlpEnabled 时，注入 DEFAULT_POLICY_RULES（基于 field-classification
 * 与 inferClassification 的模式 / 关键词 PII 检测——零语义模型依赖）。
 * 注入后：
 *   - dry_run 模式：仅记录 PII 分歧信号（deny/ask_user），不拦截真实流量。
 *   - live 模式：strictly_private 数据被真实 deny，confidential 数据触发 ask_user。
 * 默认 dlpEnabled=false → 仍是无 DLP 的 Shadow 体验（向后兼容，企业档建议开启）。
 */
function buildEngine(): TrustPolicyEngine {
  const dlpRules = config.permission.dlpEnabled ? DEFAULT_POLICY_RULES : [];
  return new TrustPolicyEngine(dlpRules, undefined, { failOpen: true, verbose: false });
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
  signer?: SignerIdentity,
): void {
  try {
    const payload_hash = payloadHash(req);
    appendEvent({
      event_type: "policy_enforcement",
      timestamp: new Date().toISOString(),
      trace_id: req.sessionId || "unknown",
      session_id: req.sessionId || "unknown",
      run_id: "unknown",
      // hash-only evidence; raw payload is NOT included (guardrail retained)
      payload_hash,
      decision: result.decision,
      rule_id: result.ruleId ?? "none",
      reason: result.reason ?? "",
      data_type: req.dataType,
      recipient: req.recipient,
      enforcement_mode: mode,
      blocked: blocked ? "true" : "false",
      // 4E v0: attribution metadata (who triggered this enforcement decision).
      // Prefer explicit signer; fall back to request userId; never leak raw identity.
      signer_identity: signer
        ? { user_id: signer.user_id, ...(signer.public_key_fingerprint ? { public_key_fingerprint: signer.public_key_fingerprint } : {}) }
        : { user_id: req.userId ?? "system" },
    } as any);
    // 4F → 4R: feed this enforcement decision into the compliance anchor accumulator
    // so live blocking decisions are included in the exportable Merkle root (audit chain).
    addEnforcementEventHash(payload_hash);
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
export function enforceBeforeLlmCall(req: PolicyCheckRequest, signer?: SignerIdentity): EnforcementOutcome {
  const mode = config.policyEnforcementMode;
  const result = engine.check(req);
  const blocked = result.decision === "deny";

  if (blocked) {
    // dry_run: log divergence, but DO NOT block (shadow).
    emitEnforcementEvent(req, result, mode, mode === "live", signer);
    if (mode === "live") {
      throw new PolicyBlockedError(result);
    }
    return { decision: result.decision, blocked: false, mode, ruleId: result.ruleId, reason: result.reason };
  }

  // allow / (transform|ask_user not in v0 scope) — pass through, optionally log.
  if (mode === "live") {
    emitEnforcementEvent(req, result, mode, false, signer);
  }
  return { decision: result.decision, blocked: false, mode, ruleId: result.ruleId };
}

/** Test/diagnostic helper: current mode. */
export function currentEnforcementMode(): "dry_run" | "live" {
  return config.policyEnforcementMode;
}
