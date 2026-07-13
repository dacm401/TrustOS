# TRST Threat Model v0.1

Version: v0.1
Stage: TRST-0.3 Strategic Baseline Pack
Date: 2026-07-13
Status: PM Review

---

## 1. Purpose

This document defines the threat boundaries for TrustOS under the **AI Execution Gateway entry strategy**. It specifies what TrustOS aims to protect against, what it does not claim to prevent, how the enforcement surface is layered, how failure modes are handled, and what evidence integrity guarantees are provided.

**This document does not claim complete AI safety or complete prevention of model hallucination.**

It exists to prevent over-promising. A company that sells trust dies by over-promising.

---

## 2. Threat Model Scope

```text
Scope: AI Execution Gateway (v1 entry product)
       Mediating agent model calls (LLM Gateway) and tool calls (MCP/Tool Broker).
       Shadow Mode: observe and report. No blocking, no redaction, no enforcement.

Out of scope: Full TrustOS with all Kernel subsystems active.
              L2 environment sandbox (future).
              Semantic DLP (future).
              Compliance certification (future).
```

This threat model covers the Gateway's interception path. Agents that do not route model/tool calls through the Gateway are outside the threat model — they are "unintegrated" and TrustOS makes no claims about their behavior.

---

## 3. What TrustOS Aims to Protect Against

| Risk | Description | v1 Gateway Coverage |
|---|---|---|
| **Unauthorized tool/action execution** | Agent calls tools or actions outside its permitted scope | Shadow Mode: observes and reports. Enforcement: TRST-2+. |
| **Secret exposure** | Raw API keys, tokens, or credentials entering model context or agent environment | v1: Credential Vacuum as design invariant (no raw secrets in agent context). Implementation: TRST-2+. |
| **Data exfiltration** | Sensitive data sent to unauthorized model providers or external APIs | Shadow Mode: records model/tool destinations and data classification flags. Blocking: future. |
| **Cost runaway** | Unbounded token consumption or model call costs | Shadow Mode: records per-call cost and session totals. Hard budget cap: future. |
| **Unobserved execution** | Agent performs actions without evidence records | **Core v1 invariant.** Every mediated call must produce an event or a telemetry failure event. |
| **Unattributed output** | Cannot trace which session/model/tool produced a given artifact | Session attribution and artifact refs in event envelope from day one. |
| **Silent event loss** | Evidence recording fails silently | **Not permitted.** Must generate telemetry failure event or enter buffer. See §7. |

---

## 4. What TrustOS Does Not Claim to Prevent

This section is the most important part of the threat model. **Statements here are contractual: we will not claim to prevent these, even if marketing wants to.**

| Non-claim | Rationale |
|---|---|
| **All model hallucinations** | TrustOS manages execution boundaries, not model truthfulness. Hallucination is a model-level problem. |
| **All prompt injection** | TrustOS can reduce injection surface (credential vacuum, tool mediation), but cannot prevent all linguistic attacks on LLM reasoning. |
| **Intentional user bypass** | A user who deliberately routes agent traffic around the Gateway is outside coverage. The Gateway is a mediation point, not a cage. |
| **Unintegrated agents** | Agents not configured to use the Gateway/Broker are invisible to TrustOS. |
| **Semantic DLP perfection** | v1 Gateway does pattern-based detection (key patterns, PII regex), not semantic understanding of sensitive content. |
| **Compliance certification** | TrustOS produces structured evidence that *supports* compliance (SOC2, ISO42001, EU AI Act), but does not self-certify. |
| **Agent code integrity** | TrustOS mediates external calls; it does not verify the agent's internal logic, prompt engineering, or runtime state. |

---

## 5. Three-Layer Enforcement Surface

TrustOS defenses are organized in three layers. TRST-1 implements only L1.

| Layer | Mechanism | TRST-1 Status |
|---|---|---|
| **L1: Protocol Layer** | LLM Gateway + MCP/Tool Broker | **Implemented in TRST-1** (Shadow Mode only: observe, record, report) |
| **L2: Environment Layer** | Sandbox, egress control, network policy, filesystem isolation | **Documented only.** Not implemented. |
| **L3: Credential Layer** | Secrets Vault, credential vacuum, secrets injection at execution time | **Design invariant defined.** Implementation: TRST-2+. |

### 5.1 L1: Protocol Layer (TRST-1)

The LLM Gateway and MCP Broker intercept agent-to-model and agent-to-tool calls. In TRST-1 Shadow Mode:
- All calls pass through the Gateway/Broker
- Every call generates an evidence event
- No blocking, redaction, or policy enforcement
- Report summarizes: what was called, by whom, at what cost, with what data classification flags

**Why this layer matters even without enforcement:** It makes agent behavior observable. Without it, TrustOS is blind.

### 5.2 L2: Environment Layer (Future)

Sandbox constraints on the agent's execution environment:
- Network egress allowlists
- Filesystem access restrictions
- Process isolation
- Container-level resource limits

**Why deferred:** Environment controls require agent runtime integration that varies by agent framework. L1 (protocol) is universal; L2 is agent-specific.

### 5.3 L3: Credential Layer (Future, Design Invariant Now)

**Credential Vacuum is the architectural foundation of non-bypassability:**

```text
Agents receive capability handles, not raw secrets.
Secrets live in the TrustOS Vault and are injected by brokers at execution time.
The agent's context never contains a real API key, token, or credential.
```

If the agent environment has no raw secrets, bypassing the Gateway loses most of its value — the attacker gets a capability handle, which can execute only within the policy constraints attached to that handle.

**Design invariant from day one:** The event envelope reserves `capability_ref` and credential-masking fields. Even though TRST-1 does not implement secrets injection, the schema must not need to be redesigned when it does.

---

## 6. Credential Vacuum: Detailed Justification

Credential Vacuum is not a convenience feature — it is the answer to the fundamental question: **"If prompt injection can compromise the agent's reasoning, what stops the attacker from stealing credentials and using them directly?"**

The answer:

```text
There are no credentials in the agent's reasoning to steal.
The agent holds a capability handle — a time-bound, scope-limited,
policy-constrained proxy. The real credentials never enter the agent's context.
```

This is the engineering answer to the "cognitive boundary is undefendable" problem:
- We cannot prevent all prompt injection.
- We cannot guarantee the agent never hallucinates dangerous actions.
- But we can guarantee that even a fully compromised agent has no raw credentials to leak, and any action it attempts goes through a policy gate.

**Credential Vacuum turns prompt injection from a credential-theft problem into an access-policy problem.** Policy gates are enforceable; cognitive boundaries are not.

---

## 7. Failure Modes

TrustOS must fail in predictable, safe ways. Every failure mode has a defined expectation.

| Failure Mode | Expected Behavior |
|---|---|
| **Gateway unavailable** | Fail-open vs. fail-closed is deployment-configurable. Default recommendation: fail-closed for write/irreversible tools, fail-open for read-only tools. TRST-1 default: TBD per design partner environment. |
| **Evidence write failure** | **Silent loss is not permitted.** Must generate `telemetry_failure` event or buffer and retry. If buffering, must signal buffer state in next successful event. |
| **Policy unavailable** | TRST-1 does not enforce policy. For future enforcement mode: default-deny on policy engine unavailability. |
| **MCP Broker error** | Record `tool_call_error` event with error details (sanitized: no raw credentials or stack traces). Agent receives standard MCP error response. |
| **LLM upstream failure** | Record `model_call_failed` event with provider, model, error type. Pass error to agent through standard API error response. |
| **Shadow report incomplete** | Mark report as `incomplete` with explicit coverage gap description. Never pretend completeness. |
| **Event buffer overflow** | If event buffer exceeds threshold, prioritize: (1) drop oldest non-critical events first, (2) emit `buffer_overflow` telemetry event, (3) never drop events silently. |

---

## 8. Evidence Integrity

```text
TrustOS v1 targets tamper-evidence, not absolute tamper-proofing.
```

### 8.1 What tamper-evidence means

- **Merkle/hash linkage:** Events are linked by content hashes, forming a chain where any modification is detectable.
- **Append-only storage:** Events cannot be deleted or modified in-place. New events can only be appended.
- **Causal graph structure:** Evidence is not a flat log but a graph where edges represent causal relationships. Tampering with one node breaks hash chains and alters graph topology — both detectable.

### 8.2 What tamper-evidence does not mean

- **Not tamper-proof:** A sufficiently privileged attacker (root access, database admin) could rewrite the entire event store and recompute hashes. Tamper-proofing requires external anchoring (timestamp services, blockchain anchoring, WORM storage) — these are future enterprise enhancements.
- **Not end-to-end cryptographic verification:** v1 does not implement signing or external verification. Events are structured for future signing but not signed in TRST-1.

### 8.3 Practical guarantee

For the v1 threat model (Shadow Mode, single-tenant, user-deployed Gateway):

```text
Evidence integrity against: accidental corruption, casual tampering,
unauthorized modification by non-admin users.
Evidence integrity not claimed against: root-level database compromise,
deliberate full-system rewrite by administrator.
```

---

## 9. Shadow Mode Boundary

Shadow Mode is not a weakened form of enforcement — it is a fundamentally different operating mode with its own threat model.

```text
Shadow Mode observes and reports.
Shadow Mode does NOT:
  - Block any model or tool call
  - Redact any content
  - Enforce any policy
  - Inject any secrets
  - Modify any request or response
  - Add latency beyond passthrough + event recording
```

### 9.1 Why Shadow Mode is secure enough for v1

Shadow Mode's security value is not in blocking attacks — it is in **making attacks visible and attributable**:

- If an agent exfiltrates data, the Shadow Report shows: which model received what data, when, in which session.
- If an agent makes unauthorized tool calls, the Shadow Report shows: which tools, with what arguments, at what time.
- If costs spiral, the Cost Ledger shows: which session, which model, how many tokens.

**Shadow Mode turns invisible risk into visible evidence.** This alone addresses the primary v1 user pain: "I don't know what my agents are doing."

### 9.2 Transition to Enforce Mode

Enforcement mode is opt-in, per session or per project:

1. User reviews Shadow Reports over a trial period
2. User identifies patterns they want to enforce (e.g., "never send PII to cloud models", "require approval for git push")
3. User enables Enforce Mode for specific rules
4. Gateway begins blocking/flagging/approving based on active policies

This graduated transition respects user autonomy and builds trust incrementally.

---

## 10. Threats to TrustOS Itself

TrustOS is a security product, which makes it a target.

| Threat | Mitigation |
|---|---|
| **Gateway impersonation** | Agent config points to Gateway endpoint; Gateway identity verified by TLS (mutual TLS in enterprise). |
| **Event log tampering** | Append-only design + hash chaining (tamper-evident). External anchoring for enterprise. |
| **Gateway bypass** | Credential Vacuum reduces bypass incentive. If environment has no raw secrets, bypassing the Gateway does not grant credential access. |
| **Side-channel leakage** | Event content must not expose raw secrets (sanitization before recording). Gateway metrics (latency, timing) must not leak information about secret values. |
| **Denial of service** | Rate limiting on Gateway. Gateway overload → fail-open or fail-closed per deployment config. |

---

## 11. Version History

| Version | Date | Changes |
|---|---|---|
| v0.1 | 2026-07-13 | Initial threat model for AI Execution Gateway entry strategy. Defines protection scope, non-claims, three-layer enforcement, credential vacuum, failure modes, evidence integrity, Shadow Mode boundary. |
