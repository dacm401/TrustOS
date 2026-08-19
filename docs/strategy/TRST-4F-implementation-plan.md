# TRST-4F Policy Enforcement — Implementation Plan (DRAFT, plan-only)

```text
Status:        DRAFT IMPLEMENTATION PLAN (NOT authorized to implement)
Date:          2026-08-19
Depends on:     TRST-4F-policy-enforcement-charter.md (DRAFT charter)
Trigger:       MWT-21 ✅ + MWT-22 ✅ — Governance Closure "完成中等后进行" gate SATISFIED
Gate to start: explicit Boss directive APPROVE_TRST-4F_IMPLEMENTATION + scope choice
               (which of block / hold / override are in v0)
```

---

## 0. What this plan is / is not

- IS: a concrete, code-aware execution plan that turns the 4F charter into an
  implementation sequence. Every step names the real file + real symbol already
  in the repo.
- IS NOT: implementation. No code is written by this document. 4F remains
  UNAUTHORIZED until `APPROVE_TRST-4F_IMPLEMENTATION`.

Red lines carried from charter (unchanged): no DLP, no Trust Spine / Memory
change, no raw-content expansion, additive migrations only, works within current
`X-User-Id` trust boundary (4E deferred).

---

## 1. Existing assets (reuse, do not rebuild)

| Asset | Path | Role in 4F |
|---|---|---|
| `TrustPolicyEngine` | `src/trust/policy-engine.ts` (`export class TrustPolicyEngine`, decision `allow|deny|transform|ask_user`) | The decision half — ALREADY implemented + tested, NEVER CALLED in execution path |
| Assessment control label | `src/services/assessment/assess-engine.ts` + `src/api/assess.ts` (MWT-22) | Returns `control.action: allow|review|would_block`, `runtimeEffect:"none"` (dry-run) |
| Contract gate (HITL) | `src/services/manager/execution-attempt-service.ts` (MWT-21) | Only APPROVED contracts may run real worker |
| Gateway interception | chat → gateway forwarder | Natural insertion point for real block / hold |
| Event Backbone | existing event emit path | Enforcement actions recorded as hash-chained events (no silent loss) |

**Insight (from charter §2)**: the *decision* half exists. 4F is the *action* half
+ human-override + an enforcement toggle (dry-run shadow → live).

---

## 2. Scope decision needed from Boss (charter §7 open questions)

Before any code, Boss must pick v0 scope:

- [ ] **Block**: `deny` / `would_block` → request NOT forwarded to upstream + emit enforcement event.
- [ ] **Hold**: `ask_user` / `review` → pre-execution mandatory-approval gate (operator override required).
- [ ] **Override flow**: blocked/held action can be overridden by operator; override is a first-class hash-chained event.
- [ ] **Dry-run shadow window**: how long to run decisions side-by-side with `allow` (log divergences, no real block) before go-live? Default proposal: until N sessions or explicit Boss flip.

Open Q resolved by MWT-21 live run (2026-08-19): real worker runtime is
live-validated (output_hash SHA-256, raw not stored) — so 4F does NOT need to
wait for a separate real-worker validation.

---

## 3. Implementation sequence (once authorized)

### Phase 0 — Enforcement toggle (additive, zero behavior change)
- Add config flag `POLICY_ENFORCEMENT_MODE: "dry_run" | "live"` (default `dry_run`).
- Wire into `TrustPolicyEngine` constructor / config so decision is always
  computed, but action applied only when `live`.
- Migration: NONE (config only). Instant rollback = flip flag → `dry_run`.

### Phase 1 — Decision wiring (call the dead engine)
- In the Gateway forwarder path, call `TrustPolicyEngine.evaluate(...)` on
  outbound user_message / result before forwarding.
- Map `PolicyDecision` → control effect:
  - `allow` → passthrough (unchanged).
  - `deny` → (dry_run: log; live: block + emit enforcement event).
  - `ask_user` → (dry_run: log; live: hold + emit hold event, await operator).
  - `transform` → (dry_run: log intended transform; live: apply redact/mask per
    `DataTransform`, emit transform event). NOTE: transform touches payload
    metadata only, never raw semantic content (red line).
- Reuse MWT-22 assess `control.action` as a secondary signal; resolve conflicts
  by fail-closed (deny wins).

### Phase 2 — Enforcement events (no silent loss)
- Each block / hold / transform emits an `enforcement_event` into the Event
  Backbone: `{ decision, rule_id, policy_hash, session_id, trace_id, mode }`.
- Event carries hashes only (no raw payload) — preserves Evidence Graph contract.

### Phase 3 — Human override / appeal (if in v0 scope)
- Operator override endpoint: `POST /v1/enforcement/:eventId/override`
  (guarded by current `X-User-Id` boundary; operator-only in v0).
- Override recorded as first-class `override_event` (who, when, reason).

### Phase 4 — Dry-run shadow validation
- Deploy `dry_run` mode; run defined window; collect divergence log
  (would-have-blocked vs actually-allowed).
- Report: divergence count, false-block risk, readiness for `live` flip.

### Phase 5 — Flip + rollback test
- Boss flips `POLICY_ENFORCEMENT_MODE=live` after Phase 4 clean.
- Rollback test: flag → `dry_run` reverts all blocking instantly (staging-verified).

---

## 4. Files touched (estimate)

- `src/trust/policy-engine.ts` (call from execution path; add mode flag)
- `src/gateway/*` forwarder (insert enforcement check) — confirm exact path pre-impl
- `src/api/enforcement.ts` (NEW, if override in scope)
- `src/services/assessment/assess-engine.ts` (conflict resolution helper, optional)
- config (`.env.private-beta.example` adds `POLICY_ENFORCEMENT_MODE`)
- tests: `src/trust/policy-engine.enforcement.test.ts` (port existing 12KB test +
  add live-mode assertions)

No migrations required (config flag only). All additive.

---

## 5. Validation gates

- `npm run validate` 0 errors (no real FAIL).
- `npm run beta:check` no regression.
- New enforcement tests: dry-run logs, live blocks, override event hash-chained.
- Rollback toggle verified in staging.
- `private-beta-limitations.md` updated ONLY after `live` flip: remove
  "no autonomous policy execution / no real enforcement" claim — until then the
  claim REMAINS TRUE (honesty boundary).

---

## 6. Next action

Boss: provide `APPROVE_TRST-4F_IMPLEMENTATION` + scope choice (Block / Hold /
Override / dry-run window). On that directive, Phase 0–5 execute in this repo
without touching Trust Spine / Memory / raw content.
