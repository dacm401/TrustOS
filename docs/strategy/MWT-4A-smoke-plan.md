# MWT-4A Smoke Plan — Task Evidence Projection

**Status**: PLANNING DOC ONLY — no implementation authorized.  
**Date**: 2026-08-10  
**Task**: Post-MWT-3B1 Task Pack Task 5.  
**Target**: Validate MWT-4A (frontend-only) against 10 PM-required smoke cases.

---

## 1. Design Principles

```text
- All smoke runs against EXISTING Gateway endpoint GET /v1/events?task_id=<id> (MWT-3B1).
- Use synthetic events (pre-seeded .trustos/events.jsonl with known task_id) — no live API key needed.
- Frontend smoke via component render test (e.g. vitest + @testing-library/react) OR a lightweight
  node harness that calls the fetch wrapper against a local gateway instance.
- No backend changes. No schema changes. No new routes.
```

---

## 2. Ten Required Smoke Cases

| # | Case | Expected | Maps to AC |
|---|------|----------|------------|
| S1 | task_id with correlated events → projection renders | Summary card + timeline visible | AC1, AC2 |
| S2 | task_id with 0 events → empty state | Graceful "no evidence" message, no crash | AC8 |
| S3 | task_id=null (unassigned) → not selectable / fallback | UI only selects real task_ids; never queries null | AC9-adjacent |
| S4 | lifecycle events appear in evidence sections | session_start / session_end / task events listed | AC5 |
| S5 | model_call events appear | model_call rows with token/cost metrics | AC3, AC5 |
| S6 | tool_call events appear (if present) | tool_call rows with tool + arg hash | AC5 |
| S7 | worker_error / timeout / cancelled appear (if present) | error/terminal rows with error_code | AC5 |
| S8 | existing Evidence view unchanged | Event-scoped EvidenceReportPanel still renders independently | AC9 |
| S9 | no backend/API/schema changes | git diff for MWT-4A contains frontend files only; backend tsc remains 0 errors as regression check | AC10 |
| S10 | frontend build PASS | `npm run build` (or existing static build) succeeds | AC12 |
| S11 | no raw prompt/output content displayed | Timeline rows show hashes/metadata only; assert no raw `prompt`/`output`/`messages` fields rendered | AC6, AC7, guardrail 14 |
| S12 | no run_id / trace_id / export / policy UI appears | Assert TaskEvidenceView DOM contains none of: run_id, trace_id, export button, policy/approval controls | AC10, guardrails 8-12 |

---

## 3. Harness Sketch

```ts
// scripts/mwt4a/run-smoke.mts (tsx) — node harness against local gateway
// OR vitest component test under frontend/

import { fetchGatewayEventsByTask } from '../frontend/src/lib/api';

const GATEWAY = process.env.GATEWAY_URL ?? 'http://localhost:3000';

async function main() {
  // S1: real task_id with events
  const withEvents = await fetchGatewayEventsByTask('task-smoke-001');
  assert(withEvents.events.length > 0, 'S1: projection has events');

  // S2: empty task
  const empty = await fetchGatewayEventsByTask('task-smoke-empty');
  assert(empty.events.length === 0, 'S2: empty state');

  // S5/S6/S7: event type coverage
  const types = new Set(withEvents.events.map(e => e.event_type));
  assert(types.has('model_call'), 'S5: model_call present');
  // tool_call / errors asserted if seeded

  // S9: git diff frontend-only; backend tsc regression check (separate gate)
  report(10 cases, pass/fail);
}
```

> Frontend render smoke (S1/S2/S8 UI behavior) best covered by a vitest component test
> mounting `<TaskEvidenceView taskId="..." />` with a mocked `fetchGatewayEventsByTask`.

---

## 4. Pre-Seeding Requirement

```text
Seed .trustos/events.jsonl (or SQLite events index) with:
  - task-smoke-001: ≥1 session_lifecycle + ≥1 model_call + ≥1 tool_call + ≥1 error (optional)
  - task-smoke-empty: 0 events
These are synthetic, privacy-safe (hashes only, no raw content).
```

---

## 5. Acceptance Gate

```text
All 10 cases PASS → MWT-4A smoke GREEN.
Backend TSC: 0 errors (retained from cleanup).
Frontend build: PASS.
No backend file in git diff.
```

---

## 6. Notes

- S3 (task_id=null) is a UI-guard case — verify the selection layer never emits a null task_id query.
- S9/S10 are cross-cutting gates, not component logic — enforced by CI tsc + build.
- This plan is documentation only. Execution occurs only after PM issues
  `MWT-4A IMPLEMENTATION_AUTHORIZED`.

---

*Plan: 2026-08-10. Read-only planning. No code.*
