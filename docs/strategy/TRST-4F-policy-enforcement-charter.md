# TRST-4F Policy Enforcement Charter (DRAFT — Planning only, no implementation authorized)

```text
Status:        DRAFT (planning baseline, NOT implementation)
Date:          2026-08-17
Author:        Agent (autonomous, Boss-approved planning)
Trigger:       MWT-21 (real worker wiring) ✅ + MWT-22 (backend assessment API) ✅
               — both medium-effort items from the Governance Closure Plan are now
               COMPLETE, satisfying the "完成中等后进行" gate for the high-risk core.
Baseline gate: Private Beta = validated trusted observation/recording system
               (NOT governance-grade). 4F is the observation→governance shift.
```

---

## 0. Honest framing

This is a **charter draft only**. No code is written, no migration is added, no
service is changed by this document. It exists so the Boss can decide whether and
how TRST-4F (autonomous policy enforcement) should be implemented.

It does NOT claim:
- ❌ that policy enforcement is implemented
- ❌ that `would_block` becomes a real action yet
- ❌ that TrustOS is governance-grade yet
- ❌ that any 4F work is authorized to implement

The limitations statement in `private-beta-limitations.md` — ❌ "no autonomous
policy execution / no real enforcement" — **REMAINS TRUE** until 4F ships.

---

## 1. Why 4F now (and not before)

Per the 2026-08-17 Governance Closure Plan, three tiers were defined:
- EXCLUDED: 4E (identity), 4G (prod ops) — deferred by Boss.
- MEDIUM (done): Real Worker Wiring (MWT-21), Backend Assessment API (MWT-22).
- HIGH-RISK CORE (deferred until medium done): **TRST-4F Policy Enforcement**.

MWT-21 and MWT-22 are now committed (`6e5a6af`, `22049fd`). The gate condition
is satisfied. This charter upgrades 4F from `RECORDED_ONLY ⏸️` to `DRAFT` so the
Boss can evaluate the paradigm shift on concrete footing.

---

## 2. Current state — what already exists (do not rebuild)

| Asset | Path | Status |
|---|---|---|
| Policy engine (defined, decision logic) | `src/trust/policy-engine.ts` (8 KB) | DEFINED, has 12 KB test, **NEVER CALLED in execution path** |
| Assessment + dry-run control label | `src/services/assessment/assess-engine.ts` + `src/api/assess.ts` (MWT-22) | LIVE — returns `control.action: allow|review|would_block`, `runtimeEffect: "none"` |
| Contract gate (only approved may run) | `src/services/manager/execution-attempt-service.ts` (MWT-21) | LIVE — HITL boundary |
| Gateway interception point | chat → gateway forwarder | EXISTS — natural enforcement insertion point |

**Critical insight**: the *decision* half of enforcement (policy-engine + assess
control label) already exists and is tested. What is missing is the *action* half:
turning `would_block` into a real runtime effect (block / mandatory-approval /
redact) at the Gateway interception point, plus a human-override/appeal flow.
4F is therefore **wiring + action + override**, not greenfield policy logic.

---

## 3. The paradigm shift (observe → govern)

Today TrustOS is an **observation/recording** system:
- It observes events, hashes them, records completeness signals.
- `Review` (MWT-19) is an internal audit — evidence completeness, hash coverage,
  missing-signal detection — NOT governance.
- Control is dry-run: `would_block` is a label only; the system still `allow`s.

4F turns `observe + record + allow` into `observe + decide + act`:
- `would_block` → real block at Gateway (request not forwarded to upstream).
- `review` → mandatory human approval gate before execution.
- `allow` → unchanged.
- Every enforcement action is itself an audited, hash-chained event (no silent
  blocking — preserves the "no silent event loss" frozen principle).

This is the same capability the earlier 7-area map called #2 (autonomous policy
execution) + #7 (enforcement). They are one charter.

---

## 4. Scope (proposed)

### In scope
- Wire `policy-engine` decision into the execution path (currently dead code).
- Map assessment `control.action` → real Gateway behavior:
  - `would_block` → block + emit enforcement event
  - `review` → pre-execution mandatory-approval hold
  - `allow` → passthrough
- Human-override / appeal flow for blocked or held actions (who can override, log
  the override as a first-class event).
- Enforcement events enter the same Event Backbone (hash-chained, no silent loss).
- Dry-run shadow mode FIRST: run enforcement decisions side-by-side with allow,
  log divergences, no real blocking — until Boss flips the switch.

### Out of scope (guardrails — carry from TRST-3)
- No DLP detection (semantic or pattern-based) — frozen consensus.
- No Trust Spine semantic/hashing changes.
- No Memory Governance bypass.
- No raw content expansion (enforcement decisions stay metadata/hash-driven).
- Migrations additive/reversible only.
- No auth/RBAC overhaul (4E deferred) — 4F must work within current
  `X-User-Id` trust boundary; flag the dependency explicitly.

---

## 5. Risks & red lines (why this was deferred, not skipped)

| Risk | Mitigation |
|---|---|
| False-block on clean traffic (over-enforcement) | Dry-run shadow mode; `would_block` only on high-severity privacy/trace_integrity signals, never on operational/behavioral |
| Silent blocking violates "no silent event loss" | Every block/hold is an explicit hash-chained event |
| Couples to identity boundary (4E deferred) | Document 4E as hard dependency for override attribution; 4F override is operator-only in v0 |
| Trust Spine / Memory touched | Explicit red line; enforcement is metadata-only, never reads/modifies raw payloads |
| Rollback safety | Enforcement toggle is config-flagged; instant revert to dry-run |

---

## 6. Sequencing & decision gates

4F should NOT enter implementation until:
1. This charter reviewed and scoped by Boss (which sub-capabilities: block? hold?
   override? all three?).
2. Dry-run shadow mode deployed and observed for a defined window (no real blocks).
3. Rollback plan validated (toggle → dry-run, verified in staging).
4. Explicit Boss directive: `APPROVE_TRST-4F_IMPLEMENTATION` with chosen scope.

This draft becomes an **authorized implementation charter** only by that directive.

---

## 7. Open questions for Boss

- Which enforcement actions are in v0: block only? hold-only? both? override flow?
- Is dry-run shadow window length defined (e.g. N sessions / days) before go-live?
- Override authority: operator-only (current identity boundary) acceptable for v0,
  or is 4E (authenticated identity) a prerequisite before 4F ships?
- Does 4F require the real worker runtime (MWT-21) to be live-validated first, or
  is the zero-DB seam sufficient for charter approval?

---

## 8. Source of truth

- Governance Closure Plan: `docs/strategy/TRST-execution-log.md` (§1522, §1583)
- Policy engine (defined, un-wired): `src/trust/policy-engine.ts`
- Assessment + dry-run control: `src/services/assessment/assess-engine.ts`, `src/api/assess.ts` (MWT-22)
- TRST-4 umbrella draft: `docs/strategy/TRST-4-charter-draft.md`
- Private Beta limitations (honesty boundary): `docs/private-beta-limitations.md`
