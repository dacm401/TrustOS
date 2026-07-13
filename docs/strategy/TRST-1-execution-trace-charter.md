# TRST-1 Execution Trace MVP Charter

Version: v0.1
Stage: TRST-0.3 Strategic Baseline Pack
Date: 2026-07-13
Status: Draft for PM Review
Implementation: **HOLD**

---

## 1. Charter Purpose

This Charter defines what TRST-1 must validate before TrustOS enters full implementation. It is **not an implementation plan, not a detailed design document, and not a sprint scope.**

It is the PM gate: TRST-1 implementation must not start until this Charter is reviewed and accepted by PM.

---

## 2. Core Hypothesis

TRST-1 exists to validate exactly one hypothesis:

```text
Can TrustOS reliably sit in the execution path of real agents,
capture model/tool calls with acceptable overhead,
and generate a unified shadow evidence report?
```

Everything in TRST-1 serves this hypothesis. Anything that does not directly serve validating this hypothesis is out of scope.

### 2.1 What "validated" means

The hypothesis is validated when:

1. An OpenAI-compatible client and an MCP client successfully route through the Gateway with all calls captured as events
2. Gateway overhead is measured and confirmed to be acceptable (< 5% of upstream model latency)
3. A complete Shadow Report is generated covering model calls, tool calls, cost, and basic context metadata
4. Zero silent event loss — every mediated call produces either an event or a `telemetry_failure` event

### 2.2 What the hypothesis excludes

- Policy enforcement (blocking, redaction, approval)
- Semantic DLP
- Capability token enforcement
- Secrets injection
- Multi-tenant isolation
- Performance at scale
- Production deployment readiness

---

## 3. In Scope

TRST-1 implements only what is needed to validate the core hypothesis.

### 3.1 LLM Gateway (Shadow Mode)

| Item | Scope |
|---|---|
| OpenAI-compatible proxy path | One path, one provider initially |
| Model call capture | Record model, provider, token count, latency, cost estimate |
| Context Trace Lite | Record context block metadata: source type, token count, privacy flag. No relevance scoring. |
| Passthrough only | No blocking, no redaction, no content modification |

### 3.2 MCP Broker (Shadow Mode)

| Item | Scope |
|---|---|
| MCP protocol proxy | One MCP server passthrough path |
| Tool call capture | Record tool name, args hash, result hash, latency |
| Passthrough only | No blocking, no policy evaluation |

### 3.3 Unified Event Envelope

Every mediated call produces an event with the following envelope. Fields may be empty in TRST-1; the schema reserves them for future enforcement and governance.

```
event_id            — Unique event identifier
event_type          — model_call | tool_call | session_lifecycle | telemetry_failure | ...
timestamp           — ISO 8601 with timezone
trace_id            — End-to-end trace identifier
parent_event_id     — Causal parent (for graph projection)

actor_id            — Human or agent identity
agent_id            — Agent identifier
session_id          — Session identifier
run_id              — Run/execution identifier within session
project_id          — Project/workspace identifier

source              — Origin of the call (agent name, worker ID)
destination         — Target (model provider, tool server)
resource_type       — model | tool | memory | artifact | session
resource_ref        — Specific resource identifier

model               — Model name (for model_call events)
provider            — Model provider name
tool_name           — Tool name (for tool_call events)

context_block_refs  — References to context blocks used in this call
input_hash          — SHA-256 of request content (sanitized)
output_hash         — SHA-256 of response content
args_hash           — SHA-256 of tool arguments
result_hash         — SHA-256 of tool result

token_count         — Token count (prompt + completion)
cost_estimate       — Estimated cost in USD
latency_ms          — End-to-end latency
gateway_overhead_ms — Gateway-introduced latency

privacy_flags       — Array: pii_detected | internal_only | ...
data_classification — public | internal | confidential | restricted

policy_decision_ref — Reference to policy decision (future)
capability_ref      — Reference to capability token (future)
approval_ref        — Reference to approval record (future)

artifact_refs       — References to produced artifacts

status              — success | failure | blocked (future) | redirected (future)
error_code          — Error code if status is failure
error_message       — Sanitized error message
```

**Key principle:**

```text
TRST-1 does not fill every field.
The envelope reserves OS primitive relationships for future enforcement and governance.
Schema evolution must be additive — existing fields are never removed or redefined.
```

### 3.4 Session Attribution

Every event is attributed to a `session_id` and optionally `run_id`. This enables:
- Per-session cost accounting
- Per-session event filtering
- Session → event causal chain construction

### 3.5 Cost Ledger Lite

| Item | Scope |
|---|---|
| Per-call cost | Record model, token counts, estimated USD cost |
| Per-session aggregation | Sum costs, tokens, calls per session |
| No hard budget cap | Cost caps are documented as future, not implemented |

### 3.6 Tool Trace Lite

| Item | Scope |
|---|---|
| Tool name | Record which tool was called |
| Args hash | SHA-256 of arguments (not raw args, to avoid log sensitivity) |
| Result hash | SHA-256 of result |
| Latency | Tool call duration |

### 3.7 Shadow Report

A human-readable summary generated from captured events:

```
Model calls observed:        N
Tool calls observed:         N
Total tokens:                N
Estimated cost:              $X.XX
Gateway overhead (avg):      Xms
Top expensive calls:         [session, model, tokens, cost]
Context blocks recorded:     N (by type)
Events captured:             N
Events failed (if any):      N
Coverage limitations:        [explicit gaps]
```

**Non-claims:**
- Not compliance-ready
- Not a Trust Card
- Does not include semantic DLP findings
- Does not guarantee cost savings

### 3.8 Latency Measurement

Gateway overhead is measured as:

```text
gateway_overhead_ms = (event_timestamp - request_received_timestamp) + (event_write_duration)
```

Target: **P50 < 10ms, P99 < 50-100ms** for event recording on the synchronous path.
Evidence write is asynchronous and does not block the proxied request.

### 3.9 Failure Telemetry

```text
Silent event loss is NOT permitted.
Every mediated call must produce either:
  - A valid event, or
  - A telemetry_failure event recording what was lost and why
```

---

## 4. Out of Scope

The following are explicitly excluded from TRST-1. If they appear in implementation, TRST-1 has exceeded its Charter.

| Module | Reason |
|---|---|
| **Policy enforcement** | TRST-2. Requires Policy Engine. |
| **Approval flow** | TRST-2. Depends on policy decisions requiring human input. |
| **Semantic DLP** | Too heavy. Pattern-based detection only (key regex, PII patterns). |
| **Capability token enforcement** | TRST-2. Schema reserves `capability_ref` field. |
| **Secrets injection** | TRST-2. Credential Vacuum is a design invariant; implementation is later. |
| **Formal Trust Card** | Depends on Evidence Graph maturity and structured evidence export. |
| **Memory Manager** | Governance phase (M4+). Requires outcome feedback data. |
| **Model Scheduler** | Governance phase (M4+). Requires cost/perf data across models. |
| **Context semantic relevance** | Requires outcome feedback and rework analysis over time. |
| **L2 environment sandbox** | Long-term. Requires per-agent-framework integration. |
| **Compliance certification** | TrustOS produces audit data; it does not self-certify. |
| **Multi-tenant isolation** | Single-tenant deployment for TRST-1 design partner validation. |
| **Production hardening** | TRST-1 is a validation milestone, not a production release. |
| **UI/UX beyond Shadow Report** | Report is plain output; no dashboard, no charts, no interactive UI. |

---

## 5. Validation Targets

| Metric | Target | Notes |
|---|---|---|
| **Setup time** | < 30 minutes for one assisted design partner environment | Manual assistance is acceptable. Measuring: real-person + real-agent setup. |
| **Gateway overhead** | < 5% of upstream model latency | Measured as gateway_overhead_ms / (latency_ms - gateway_overhead_ms). |
| **Event coverage** | 100% of mediated calls produce an event or telemetry failure event | Zero silent loss. Asserted by automated check. |
| **Silent loss** | 0 events | Asserted. Any silent loss is a TRST-1 failure. |
| **Shadow Report** | At least one complete report generated end-to-end | From agent setup → calls captured → report rendered. |
| **Compatibility** | At least one OpenAI-compatible client and one MCP path validated | Gate check: if neither protocol can be proxied, TRST-1 fails. |
| **Scope discipline** | 0 implementations of policy / approval / DLP / capability enforcement | Asserted by code review against Out of Scope list. |

---

## 6. Non-Goals

TRST-1 is a validation milestone, not a product release.

```text
NO implementation code beyond what validates the hypothesis.
NO schema migration on existing TrustOS database.
NO UI changes to existing frontend.
NO worker/runtime refactor.
NO Gateway production deployment.
NO TRST-1 execution beyond Charter-defined validation.
```

---

## 7. PM Gate

```text
TRST-1 implementation must not start until this Charter
is reviewed and accepted by PM.

Acceptance criteria:
  - Core hypothesis is clear and singular
  - In Scope is minimal and converged
  - Out of Scope is explicit and complete
  - Event Envelope reserves all needed future fields
  - Shadow Report definition is appropriately modest
  - Validation targets are measurable
  - Implementation: HOLD is unambiguous
```

---

## 8. Version History

| Version | Date | Changes |
|---|---|---|
| v0.1 | 2026-07-13 | Initial Charter for TRST-1 Execution Trace MVP. Defines core hypothesis, in/out of scope, unified event envelope, shadow report, validation targets, PM gate. |
