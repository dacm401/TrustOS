# MWT-5 Option Matrix

> **Status**: DECISION_FRAMING_ONLY ✅ (implementation NOT authorized)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream C
> **Companion**: `MWT-5-decision-record-draft.md`, `MWT-5-architecture-prebrief.md`

## 0. Purpose

A compact matrix view of the 5 MWT-5 decision points with options and recommended
defaults, so the PM can scan and decide quickly. "Recommended" is NOT approval.

## 1. Matrix

| ID | Decision | O1 | O2 | O3 | Recommended | Key trade-off |
|----|----------|----|----|----|-------------|---------------|
| D1 | Ordering vs MWT-4E | MWT-5 first | MWT-4E first | Parallel | **O1** | speed vs attributed actor |
| D2 | Persistence | JSONL sidecar | SQLite table | In-memory | **O1** | no-migration vs queryability |
| D3 | Identity | opaque approver_id | reuse envelope actor | wait MWT-4E | **O1** | ships now vs cryptographically bound |
| D4 | Schema gate | new approval type | sidecar record | global gate rule | **O2+O3** | visibility vs frozen schema |
| D5 | Advisory/enforce | advisory only | soft-enforce warn | hard-enforce block | **O1** | safe vs preventive |

## 2. Cross-impact notes

- D2 (JSONL) + D4 (sidecar) are consistent: approval is a sidecar JSONL, not a new event type.
- D3 (opaque id) + D1 (MWT-5 first) are consistent: no identity dependency blocks MWT-5.
- D5 (advisory) keeps MWT-5 out of enforcement (MWT-7), preserving the frozen boundary.
- If PM picks D1=O2 (MWT-4E first), then D3 should follow MWT-4E's identity primitive.

## 3. Recommended default bundle (for reference, not approval)

```text
D1 = O1   MWT-5 first
D2 = O1   JSONL sidecar
D3 = O1   opaque approver_id
D4 = O2+O3 sidecar record + global schema gate
D5 = O1   advisory only
```

This bundle keeps MWT-5 fully inside the no-schema-change, no-enforcement, no-auth boundary.

## 4. What each non-default choice would require

| Choice | Extra work / risk |
|--------|-------------------|
| D1=O2 | MWT-4E must land first → sequence slip |
| D2=O2 | SQLite migration + schema gate + validation of new table |
| D3=O2 | tie approval to envelope actor semantics (may be agent, not human) |
| D4=O1 | new TrstEventType → schema gate + migration + event-graph change |
| D5=O2/O3 | policy engine scope → spills into MWT-7 |

## 5. Validation implications

Documentation only. No `npm run validate` impact.
