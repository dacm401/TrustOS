# TRST Consolidated Risk Register

> **Status**: CONSOLIDATED ✅
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream E
> **Scope guard**: documentation consolidation; no code changes. Supersedes scattered
> risk lists in MWT-5-risk-register.md and standing-backlog report (kept for history).

## 0. Purpose

One authoritative risk list for TRST forward work. Each risk: ID, title, severity,
affected milestone, description, current mitigation, owner/decision needed, status.

Severity scale: LOW / MED / HIGH. Status: OPEN / MITIGATED / ACCEPTED / DEFERRED.

---

## R1 — MWT-4B reviewer dependency
- **Severity**: HIGH
- **Affected**: MWT-4B
- **Description**: MWT-4B could not start until CHECKPOINT_2 reviewer feedback + PM approval
  arrived. Blocked by external human action.
- **Mitigation**: Forward-readiness packet prepared; PM authorized implementation
  2026-08-10; minimal slice delivered and validated (9/9).
- **Owner/Decision**: PM (approved start)
- **Status**: RESOLVED (MWT-4B minimal slice IMPLEMENTED 2026-08-10)

## R2 — MWT-4B export/signing scope boundary
- **Severity**: MED
- **Affected**: MWT-4B
- **Description**: Export could silently grow into signing infra / trust-root / PKI.
- **Mitigation**: `MWT-4B-non-goals-and-boundaries.md` firewall; hash-manifest (integrity
  seal) only, explicitly named NOT an external signature; no detached sig added.
- **Owner/Decision**: PM (G3 signing model — defaulted to integrity seal, no PKI)
- **Status**: MITIGATED (boundary enforced in code)

## R3 — MWT-5 identity primitive
- **Severity**: MED
- **Affected**: MWT-5, MWT-4E
- **Description**: Approval actor weakly identified until MWT-4E lands.
- **Mitigation**: Signed D3-O1: opaque `approver_id` string; upgrade to MWT-4E later.
- **Owner/Decision**: PM (may override D3)
- **Status**: RESOLVED (D3 signed 2026-08-10)

## R4 — MWT-5 persistence decision
- **Severity**: MED
- **Affected**: MWT-5
- **Description**: Approval record storage model undecided (JSONL vs SQLite vs memory).
- **Mitigation**: Signed D2-O1: append-only JSONL sidecar; no migration.
- **Owner/Decision**: PM (may override D2)
- **Status**: RESOLVED (D2 signed 2026-08-10)

## R5 — MWT-5 advisory-vs-enforce ambiguity
- **Severity**: MED
- **Affected**: MWT-5, MWT-7
- **Description**: Advisory approval could creep into enforcement (policy engine).
- **Mitigation**: Signed D5-O1: advisory only; enforcement scoped to MWT-7, excluded.
- **Owner/Decision**: PM (may override D5)
- **Status**: RESOLVED (D5 signed 2026-08-10)

## R6 — MWT-5 approval tamper / auditability
- **Severity**: MED
- **Affected**: MWT-5
- **Description**: Approval record could be edited post-hoc without detection.
- **Mitigation**: Append-only JSONL + hash-chain verification (mirrors event envelope).
- **Owner/Decision**: Agent (impl), PM (accept approach)
- **Status**: MITIGATED (approach defined)

## R7 — NaN token characterization in MWT-4A
- **Severity**: LOW
- **Affected**: MWT-4A
- **Description**: `NaN` token totals propagate as `NaN` (not 0); regression records this.
- **Mitigation**: R13 assertion `Number.isNaN` documents current contract; flagged for PM
  awareness, not silently changed.
- **Owner/Decision**: PM (accept characterization or request semantic fix later)
- **Status**: ACCEPTED (characterization recorded)

## R8 — Live Gateway smoke not in deterministic baseline
- **Severity**: LOW
- **Affected**: Validation governance
- **Description**: Runtime Gateway smoke (e.g. TRST-2C fresh-e2e) is non-gating.
- **Mitigation**: Explicitly marked non-gating; deterministic sections use fixtures only.
- **Owner/Decision**: Agent (governance rule)
- **Status**: MITIGATED (rule documented)

## R9 — Absence of frontend render test framework
- **Severity**: LOW
- **Affected**: MWT-4B UX, MWT-5 UI
- **Description**: No click-through / render test for reviewer UI surfaces.
- **Mitigation**: UX validated via build + typecheck + manual review; noted as gap.
- **Owner/Decision**: PM (decide if a framework is in scope later)
- **Status**: OPEN (known gap)

## R10 — Schema change gate for new event types
- **Severity**: HIGH
- **Affected**: MWT-5, all future milestones
- **Description**: New `TrstEventType` could be added without review → schema drift.
- **Mitigation**: Signed D4-O3: global schema-gate rule adopted standing; MWT-5 uses
  sidecar, not new type.
- **Owner/Decision**: PM (may override D4)
- **Status**: RESOLVED (D4 signed 2026-08-10; standing gate active)

---

## 1. Risk summary

| ID | Severity | Status |
|----|----------|--------|
| R1 | HIGH | OPEN |
| R2 | MED | MITIGATED |
| R3 | MED | DEFERRED |
| R4 | MED | OPEN |
| R5 | MED | MITIGATED |
| R6 | MED | MITIGATED |
| R7 | LOW | ACCEPTED |
| R8 | LOW | MITIGATED |
| R9 | LOW | OPEN |
| R10 | HIGH | OPEN |

## 2. Top actions for PM

1. Resolve R1 by authorizing MWT-4B start (G1–G5) after reviewer feedback.
2. Adopt R10 schema-gate rule (standing).
3. Answer MWT-5 D1–D5 (R3/R4/R5 resolved by D2/D3/D5).

## 3. Validation implications

Documentation only. No `npm run validate` impact.
