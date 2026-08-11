# TRST-typecheck-baseline-cleanup — Brief

**Status**: DRAFT — READY_FOR_PM_REVIEW  
**Date**: 2026-08-10  
**Trigger**: MWT-3B1 SEAL noted 12 pre-existing typecheck errors (out of MWT-3B1 scope, not blocking).  
**Classification**: Planning document only — NO implementation authorized until PM issues cleanup authorization.

---

## 1. Context

MWT-3B1 introduced **0 new typecheck errors**. However, the backend baseline had **12 pre-existing errors** before MWT-3B1, concentrated in `src/services/trst1/`:

```text
event-index.ts        — request_mode field typing vs envelope type
evidence-report.ts    — value typing / stats shape
llm-gateway-server.ts — getStorePath() return-type usage
jsonl-event-store.ts  — getStorePath() signature
```

Per PM decision (MWT-3B1 seal, Section 4): these are **not introduced by MWT-3B1** and **not fixed due to PM scope-control**. They do not block MWT-3B1 seal. This brief proposes a **separate, scoped cleanup** so the baseline returns to 0 errors — improving signal-to-noise for future typecheck gates.

---

## 2. Goal

```text
Reduce backend typecheck errors from 12 (baseline) → 0
WITHOUT changing runtime behavior, event schema, or any MWT-3B1 code path.
```

This is a **type-only hygiene** task. It must not alter:
- event envelope wire format (`task_id` snake_case, nullable)
- `GET /v1/events` query semantics
- SQLite schema / migration
- any frontend code

---

## 3. Investigation Method (required first step)

Before any fix, run the backend typecheck to capture the **exact 12 errors with file:line**:

```bash
cd trustos
npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS" | head -50
```

Classify each into one of:
1. **Missing field in type** (e.g. `request_mode` not on `TrstEventEnvelope`) → add field to type, no runtime change.
2. **Return-type mismatch** (e.g. `getStorePath()` returns `string | undefined`, caller assumes `string`) → narrow type or guard.
3. **Stats shape mismatch** (evidence-report.ts) → align interface.

---

## 4. Scope (Authorized Surface — if PM approves)

```text
✅ Fix type errors in the 4 identified files only
✅ Add missing type fields (no runtime behavior change)
✅ Narrow/guard return types
✅ Re-run tsc to confirm 0 errors
✅ Update execution log with cleanup result
```

### Out of Scope (explicit guardrails)

```text
❌ Any runtime behavior change
❌ Event envelope / schema change
❌ SQLite migration change
❌ Frontend changes
❌ New features / refactors beyond error resolution
❌ MWT-3B1 code path modification
```

---

## 5. Files (candidates — confirmed by investigation)

| File | Expected issue | Fix type |
|------|----------------|----------|
| `src/services/trst1/event-index.ts` | `request_mode` typing vs envelope | type-field add |
| `src/services/trst1/evidence-report.ts` | `value` / stats shape | interface align |
| `src/services/trst1/llm-gateway-server.ts` | `getStorePath()` usage | type guard |
| `src/services/trst1/jsonl-event-store.ts` | `getStorePath()` signature | signature narrow |

---

## 6. Acceptance Criteria (Draft)

```text
AC1: Backend `tsc --noEmit` reports 0 errors after cleanup.
AC2: No runtime behavior change (smoke re-run not required, but MWT-3B1 smoke stays 8/8).
AC3: Event envelope wire format unchanged (task_id snake_case, nullable).
AC4: GET /v1/events query semantics unchanged.
AC5: SQLite schema / migration unchanged.
AC6: Frontend untouched, frontend build unaffected.
AC7: Execution log updated with cleanup summary (errors: 12 → 0).
```

---

## 7. Risk

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A "type fix" silently changes runtime | Low | Medium | AC2/AC3 guard; review diff for logic changes |
| Scope creep into refactor | Medium | Medium | AC out-of-scope list; diff review |
| Error count was undercounted | Low | Low | Re-run tsc; report actual number |

---

## 8. Next Steps

```text
1. PM reviews this brief
2. PM confirms cleanup is desired now (vs later)
3. PM issues cleanup authorization (or defers)
4. Investigate (Section 3) → capture exact 12 errors
5. Fix → confirm 0 errors → update log
```

**Current Status**: DRAFT — READY_FOR_PM_REVIEW. No implementation authorized.

---

*Draft: 2026-08-10. Version 1.0. Spun out from MWT-3B1 SEAL typecheck note (Section 4).*
