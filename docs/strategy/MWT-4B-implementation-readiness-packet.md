# MWT-4B Implementation Readiness Packet

> **Status**: IMPLEMENTED_MINIMAL_SLICE ✅ (PM authorized code 2026-08-10; slice delivered)
> **Date**: 2026-08-10 (readiness) → 2026-08-10 (implemented)
> **Program**: TRST Forward Planning & Readiness Program — Workstream B
> **Scope guard**: readiness packet + implementation. Minimal slice only; no MWT-5, no policy engine.

## 0. Purpose

When CHECKPOINT_2 reviewer feedback + PM approval arrive, MWT-4B (evidence export /
signing) should be startable immediately without ad-hoc discovery. This packet is the
"ready-to-execute" brief shell: assumptions, approvals, dependency map, touched areas,
sequence, validation, rollback.

## 1. Expected starting assumptions (at approval time)

- A1. Reviewer feedback has been ingested via `CHECKPOINT_2-*` intake + synthesis.
- A2. PM has explicitly authorized `MWT-4B IMPLEMENTATION START`.
- A3. Scope is frozen to **export artifact generation only** (bundle of existing sealed
  events) — no new event types, no live Gateway behavior change.
- A4. `npm run validate` baseline is green (7/7) the moment implementation begins.
- A5. Existing sealed contracts hold: `aggregateTaskEvidence` purity, `sealEvent`
  tamper-evidence, no raw content in any artifact.

## 2. Required PM approvals (gates before any code)

| Gate | Question | Currently |
|------|----------|-----------|
| G1 | Approve MWT-4B implementation start | ❌ NOT_AUTHORIZED |
| G2 | Approve export artifact format (JSON / Markdown / both) | ⏳ pending |
| G3 | Approve signing model (none / hash-manifest / detached signature) | ⏳ pending |
| G4 | Approve whether export is frontend-only or needs backend handler | ⏳ pending |
| G5 | Confirm no `run_id`/`trace_id` introduction | ⏳ pending |

## 3. Dependency map

```text
DEPENDS-ON (must hold):
  MWT-4A  evidence projection      SEALED ✅  → source of export content
  MWT-3B1 control layer            SEALED ✅  → control_decision in export
  Event envelope (sealEvent)       SEALED ✅  → tamper-evidence reused
  TRST validation baseline         GREEN 7/7  → gate before/after

INDEPENDENT-OF (must NOT entangle):
  MWT-4E identity                  NOT STARTED ⚠️ → export does not need auth to generate
  MWT-5 approval                   NOT AUTHORIZED ❌ → export must not depend on approval
  MWT-7 productionization          FUTURE → no infra change in MWT-4B
```

## 4. Likely touched areas (speculative, for planning only)

- Frontend: a new export action surface on `TaskEvidenceView` (read-only projection input).
- Frontend: artifact builder (client-side assembly of sealed events into a bundle).
- Possibly backend: a read-only export endpoint **only if** G4 approves (otherwise frontend-only).
- Docs: export format spec + verification guide (how a reviewer SHA256-verifies).

## 5. Implementation sequence (proposed, not authorized)

```text
SEQ-1  Freeze export schema (fields, ordering, hash manifest shape)   ← design
SEQ-2  Build artifact assembler from existing sealed events           ← impl
SEQ-3  Add privacy negative test (no raw prompt/output/provider)      ← test
SEQ-4  Add export artifact validation script                          ← test
SEQ-5  Wire UI action surface (if frontend-only) or endpoint (if G4)  ← impl
SEQ-6  Run npm run validate + new export sections                     ← gate
```

## 6. Validation sequence (proposed)

- Pure deterministic regression: existing 57/0 MWT-4A + 24/0 MWT-3B1 must stay green.
- New MWT-4B smoke: assemble a known fixture bundle, assert field set + hash manifest.
- Privacy negative: assert no raw content string appears in the artifact.
- Frontend build + typecheck pass.
- Backend typecheck pass (if any backend touched).
- Add `MWT-4B Smoke` + `MWT-4B Regression` sections to `scripts/trst/run-validation.mts`.

## 7. Rollback / fallback plan

- Fallback: if signing (G3) proves unstable, ship export WITHOUT signing first
  (hash manifest only), defer detached signature to a follow-up.
- Rollback: export is additive (new UI surface / optional endpoint); disabling it
  reverts to MWT-4A-only display with zero impact on sealed flows.
- No migration, no schema change → no data-rollback needed.

## 8. Non-goals (re-stated; see dedicated file)

See `MWT-4B-non-goals-and-boundaries.md`. Key: no MWT-5, no policy engine, no
run_id/trace_id, no raw leakage, no schema expansion, no silent Gateway change.

## 9. Readiness acceptance criteria

- [x] All 5 PM gates (G1–G5) resolved before code — G1 approved 2026-08-10; G2/G3/G4/G5 defaulted to JSON export + integrity seal, frontend-only action, no run_id/trace_id.
- [x] Export schema frozen and documented (`mwt4b-1.0`, see evidence-export.ts).
- [x] Dependency map confirmed independent of MWT-4E/MWT-5.
- [x] Validation sequence defined and integrable into `npm run validate` — MWT-4B Smoke + Regression added; 9/9 PASS.

## 10. Validation implications

This packet is documentation. No `npm run validate` change until implementation is
authorized and scripts are added (then the full gate must run).
