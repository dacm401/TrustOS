# MWT-5 Risk Register — Manager Policy & Approval (Dry-run)

> **Status**: ARCHITECTURE_RESEARCH_ONLY ✅ (read-only; implementation NOT authorized)
> **Date**: 2026-08-10
> **Companion**: `MWT-5-architecture-prebrief.md`
> **Scope guard**: No code, no schema change, no deps, no MWT-4B/export/signing.

## Risk taxonomy

Severity scale: HIGH (blocks a safe first implementation) · MED (needs a decision before impl) · LOW (polish).

| ID | Risk | Sev | Likelihood | Impact if unmanaged | Mitigation / Gate |
|----|------|-----|-----------|---------------------|-------------------|
| R1 | Approval persistence requires backend state not yet built | HIGH | Certain | Cannot record approvals; feature silently no-ops | Gate behind MWT-4E (identity) + durable-store strategy. Do not implement MWT-5 write path until both land. |
| R2 | `TrstEventType` extension = schema change | MED | Certain | Untracked schema drift; breaks sealed envelope assumptions | Require explicit PM schema-change authorization; reuse `sealEvent`/`computeEventHash` exactly. |
| R3 | "Who approved" needs real identity | HIGH | High | Approval has no accountable actor; audit value lost | Current `X-User-Id` header is a primitive, not auth. MWT-5 depends on MWT-4E authenticated identity. |
| R4 | Advisory-vs-enforcing confusion | MED | Medium | Team treats MWT-5 as enforcement; violates "user-mediated" principle | Architecture boundary: Manager evaluates → **user** decides → Gateway records. No blocking code in MWT-5. |
| R5 | Approval UI noise on every deny/unknown | LOW | High | Reviewer fatigue; low UX | Scope action surface to deny/unknown only; consider batch-approve as later enhancement. |
| R6 | Approval event replay / tamper | MED | Low | Fake approvals injected | Reuse existing `event_hash` envelope chain; no new crypto. Characterize in regression (see prebrief §5). |
| R7 | Scope creep into policy DSL | MED | Medium | MWT-5 balloons into policy engine (out of scope) | Freeze: MWT-5 captures decisions on *existing* control flags only; policy *authoring* is a separate charter. |
| R8 | Depends on MWT-3B1 control layer correctness | MED | Low | Wrong `control_decision` → wrong approval prompt | MWT-3B1 control layer is SEALED + has regression (24/0). Treat as frozen input. |
| R9 | Depends on MWT-4A display purity | LOW | Low | Approval logic leaks into projection | MWT-4A SEALED; `aggregateTaskEvidence` stays read-only. Add regression guard if approval events added. |
| R10 | Ordering vs MWT-4E undecided | MED | High | Implement MWT-5 before identity → rework | PM decision required: is MWT-5 gated *after* MWT-4E? (roadmap: identity/policy → enforcement last) |

## Cross-workstream dependencies

```text
MWT-4A (control_decision display)      SEALED ✅  → input to MWT-5 UI
MWT-3B1 (control layer allow/deny/unk) SEALED ✅  → input to MWT-5
MWT-4E (authenticated identity)        NOT STARTED ⚠️ → BLOCKER for R1/R3
Durable Evidence Store (TRST-4C)       CHARTER ⚠️  → BLOCKER for R1 persistence
MWT-4B (export/signing)                NOT AUTHORIZED ❌ → MWT-5 must NOT depend on it
```

## Decisions needed from PM (before any implementation brief)

1. **Ordering**: Is MWT-5 gated *after* MWT-4E identity + durable store? (recommend YES per roadmap layer order)
2. **Persistence**: Extend event archive (`task-archive-repo`) or new approval table?
3. **Identity primitive**: Is `X-User-Id` header acceptable for Private Beta, or must MWT-4E land first?
4. **Schema gate**: Approve `TrstEventType` extension (`approval_request` / `approval_decision`)?
5. **Advisory vs enforce**: Confirm MWT-5 = capture-only for first cohort (no stop-on-deny)?

## Exit criteria for leaving "prebrief" state

- [ ] PM answers the 5 decisions above
- [ ] MWT-4E identity + durable store strategy chartered
- [ ] `TrstEventType` extension authorized
- [ ] Implementation brief drafted (separate from this prebrief + policy prebrief)

Until then: MWT-5 remains `PREBRIEF_ACCEPTED_DIRECTIONAL_ONLY ⚠️`, implementation `NOT_AUTHORIZED ❌`.
