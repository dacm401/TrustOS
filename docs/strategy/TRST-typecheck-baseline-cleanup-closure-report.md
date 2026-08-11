# TRST Typecheck Baseline Cleanup — Closure Report

**Status**: CLOSED ✅ (AUTHORIZED scoped hygiene task)  
**Date**: 2026-08-10  
**Authorized by**: PM (TRST-typecheck-baseline-cleanup brief APPROVED_FOR_SCOPED_IMPLEMENTATION)  
**Scope**: Backend TypeScript type/schema alignment only — no runtime/event/API/schema behavior change.

---

## 1. Baseline (before cleanup)

```text
Backend TSC error count: 12 (pre-existing baseline, present before MWT-3B1)
```

### Error categories captured (exact, file:line)

```text
Category A — request_mode not on TrstEventEnvelope type (9 errors):
  event-index.ts(149,29)      e.request_mode access
  event-index.ts(188,34)      e.request_mode access
  evidence-report.ts(151,20)  e.request_mode access
  llm-gateway-server.ts(361,11)  request_mode in envelope literal
  llm-gateway-server.ts(394,11)  request_mode in envelope literal
  llm-gateway-server.ts(479,15)  request_mode in envelope literal
  llm-gateway-server.ts(515,15)  request_mode in envelope literal
  llm-gateway-server.ts(587,9)   request_mode in envelope literal
  llm-gateway-server.ts(642,7)   request_mode in envelope literal

Category B — .value access on {} (better-sqlite3 .get() untyped) (2 errors):
  event-index.ts(121,94)  .get("last_synced_line")?.value
  event-index.ts(195,94)  .get("last_synced_line")?.value

Category C — task_id missing in 3 envelope literals (3 errors, surfaced after A fixed):
  llm-gateway-server.ts(463,19)  stream-cancel path
  llm-gateway-server.ts(501,19)  stream-error path
  llm-gateway-server.ts(625,11)  non-streaming main path
```

> Note: Category C errors were MASKED by Category A (type-checker short-circuits on the
> unknown `request_mode` property before reaching the missing `task_id` check).
> Fixing A exposed C. Both are type-alignment only.

---

## 2. Fixes Applied

| File | Change | Category | Runtime impact |
|------|--------|----------|----------------|
| `src/services/trst1/event-envelope.ts` | Added `request_mode?: string;` to `TrstEventEnvelope` (declaration alignment — field already written by Gateway at runtime) | A | None — type only |
| `src/services/trst1/event-index.ts` | Two `.get(...)` results cast to `{ value?: string } \| undefined` | B | None — type only |
| `src/services/trst1/llm-gateway-server.ts` | Added `task_id: identity.taskId` to 3 envelope literals (463/501/625) | C | None — completes MWT-3B1 task_id coverage (was additive gap) |

**Total files changed: 3** (event-envelope.ts, event-index.ts, llm-gateway-server.ts)  
**Lines added: ~5** (1 type field + 2 casts + 3 task_id assignments)

---

## 3. Verification (after cleanup)

```text
Backend TSC error count: 0 ✅ (was 12)
  → NO_NEW_ERRORS beyond the 12 pre-existing
  → All 12 baseline errors resolved

MWT-3B1 Smoke: 8/8 PASS ✅ (1 SKIP — live model_call, no API key; synthetic path covers)
  → No regression vs pre-cleanup

Frontend: untouched — no frontend files modified, build unaffected
```

---

## 4. Guardrail Compliance (PM-required)

```text
✅ No runtime behavior change (type-only alignment)
✅ No event schema expansion (request_mode was already written at runtime — declaration only)
✅ No task_id semantic change (only completed missing assignments; nullable semantics intact)
✅ No SQLite migration (request_mode column already existed)
✅ No Gateway route change (only envelope field completeness)
✅ No frontend change
✅ No Evidence feature change
✅ No run_id / trace_id introduction
✅ v1 stash untouched
```

---

## 5. Side Effect — MWT-3B1 task_id Coverage Completion

Cleanup surfaced that 3 of the 9 Gateway envelope construction sites were missing
`task_id: identity.taskId` (stream-cancel, stream-error, non-streaming main path).
Previously the implementation had `task_id` on 6 sites. After this cleanup, **all 9
envelope sites now carry `task_id`**, fully completing MWT-3B1's correlation coverage.

This is a strict improvement to MWT-3B1 completeness — no semantic change, no new scope.
Execution log MWT-3B1 envelope-site count should be read as **9** (not 6) post-cleanup.

---

## 6. Conclusion

```text
TRST Typecheck Baseline: CLEAN ✅
Backend TSC: 0 errors
MWT-3B1 smoke: 8/8 PASS
No scope creep
```

**Status**: CLOSED ✅

---

*Draft/Closure: 2026-08-10. Authorized scoped hygiene task under MWT-3B1 Post-SEAL Task Pack.*
