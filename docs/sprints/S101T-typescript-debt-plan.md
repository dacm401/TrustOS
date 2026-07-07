# S101T TypeScript Debt Cleanup Plan

Sprint: S101T — TypeScript Debt Cleanup
Date: 2026-07-07
Status: Baseline Established — Awaiting PM Review
Predecessor: S100P ACCEPTED (snapshot `5a5bdef`)

---

## 1. Goal

Whole-project TypeScript check (`tsc --noEmit`) passes with **0 errors**.

Command:
```bash
npx tsc --noEmit
```

---

## 2. Baseline

**Date**: 2026-07-07
**Branch**: `s101t-typescript-debt-cleanup`
**Command**: `npx tsc --noEmit`
**Result**: **38 errors** across **9 files**

### Error Count by File

| # | File | Errors | Severity |
|---:|---|---|---|
| 1 | `src/services/phase3/sse-poller.ts` | 12 | High (runtime risk) |
| 2 | `src/api/chat.ts` | 9 | High (runtime risk) |
| 3 | `src/services/llm-native-router.ts` | 8 | Medium |
| 4 | `src/services/task-contract/task-contract-builder.ts` | 3 | Medium |
| 5 | `src/services/human-review/human-review-service.ts` | 2 | Low |
| 6 | `src/models/model-gateway.ts` | 1 | Low |
| 7 | `src/prompts/loader.ts` | 1 | Low |
| 8 | `src/services/task-contract/task-contract-types.ts` | 1 | Low |
| 9 | `src/services/verifier/contract-verifier.ts` | 1 | Low |
| **Total** | | **38** | |

### Error Category Distribution

| Category | Count | Description |
|---|---|---|
| TS2352 (type conversion) | 7 | `RuntimeTerminalSummary` → `Record<string, unknown>` cast |
| TS2322 (type not assignable) | 9 | Wrong type assigned to property |
| TS18047 (possibly null) | 6 | Null safety violations |
| TS2339 (property missing) | 3 | Property not on type |
| TS2304 (cannot find name) | 3 | Undefined identifiers |
| TS2307 (cannot find module) | 2 | Missing module imports |
| TS2367 (type comparison) | 2 | Discriminant union gaps |
| TS2345 (argument type) | 3 | Wrong argument type |
| TS2741 (missing property) | 1 | Required property missing |
| TS2820 (string literal) | 1 | Typo `"timed_out"` → `"timeout"` |
| TS2459 (not exported) | 1 | Module export gap |

---

## 3. Error Inventory (Detailed)

### 3.1 `src/api/chat.ts` — 9 errors

| Line | Code | Issue |
|---|---:|---|
| 341-347 | TS18047 (×6) | `llmNativeResult` possibly null — 6 dereferences after nullable |
| 556 | TS2339 | `.meta` doesn't exist on SSE event type |
| 763 | TS2339 | `.modelUsed` doesn't exist on `RequestLedger` |
| 807 | TS2345 | `{}` passed where `string` expected |

**Risk**: High. Chat.ts is the main SSE/stream hot path. Null-unsafe dereferences could cause runtime crashes.

**Fix Strategy**: 
- Lines 341-347: Add null guard or early return after `llmNativeResult` check
- Line 556: Check if `meta` field exists on SSE event type — add to type or remove usage
- Line 763: Add `modelUsed` to `RequestLedger` type or handle as optional
- Line 807: Fix argument type — trace source of `{}`

---

### 3.2 `src/models/model-gateway.ts` — 1 error

| Line | Code | Issue |
|---|---:|---|
| 132 | TS2367 | Type comparison in discriminant: `"fast"` not in union `"unknown" \| "compressor" \| "worker" \| "execution_loop" \| "planner"`. Missing enum member or dead branch. |

**Risk**: Low. Compile-time guard; likely an enum extension is needed or the `"fast"` branch is unreachable.

**Fix Strategy**: If `"fast"` is valid, add to the source enum/union type. Otherwise, remove the unreachable branch.

---

### 3.3 `src/prompts/loader.ts` — 1 error

| Line | Code | Issue |
|---|---:|---|
| 43 | TS2304 | `buildManagerSystemPrompt` not found — missing import or rename |

**Risk**: Low. Likely a stale reference after a function rename.

**Fix Strategy**: Find the actual function name (possibly `buildManagerPrompt` or imported from a renamed module) and fix the import/call.

---

### 3.4 `src/services/human-review/human-review-service.ts` — 2 errors

| Line | Code | Issue |
|---|---:|---|
| 608 | TS2322 | `"INVALID_STATUS"` not in error reason union — missing enum member |
| 628 | TS2322 | `"UNSUPPORTED_ACTION"` not in error reason union — missing enum member |

**Risk**: Low. The union type needs two new members.

**Fix Strategy**: Add `"INVALID_STATUS"` and `"UNSUPPORTED_ACTION"` to the error reason union type (likely `HumanReviewErrorReason`).

---

### 3.5 `src/services/llm-native-router.ts` — 8 errors

| Line | Code | Issue |
|---|---:|---|
| 549, 1057 | TS2322 (×2) | `artifactId` is `string \| undefined` but dest requires `string`. Nullable contract gap. |
| 1264 | TS2322 | `effectivePatchFirstEligible` property not in target type. Extraneous field. |
| 1398 | TS2345 | `string \| undefined` passed where `string` expected |
| 1817, 1818 | TS2307 (×2) | `../phases/phase4/index.js` module not found |
| 2144 | TS2304 | `slowModel` undefined |

**Risk**: Medium. The `phase4/index.js` missing imports are the main concern — may indicate incomplete Phase 4 stub. `slowModel` undeclared is a logical gap.

**Fix Strategy**:
- Lines 549/1057: Add null check before destructuring, or make target type `string | undefined`
- Line 1264: Drop extraneous `effectivePatchFirstEligible` from object literal (or add to dest type)
- Line 1398: Add null guard or default
- Lines 1817/1818: These are Phase 4 stub imports — either create a minimal `phase4/index.ts` stub or remove the dead imports if not in current scope
- Line 2144: Declare `slowModel` or import the right reference

---

### 3.6 `src/services/phase3/sse-poller.ts` — 12 errors (most concentrated file)

| Line | Code | Issue |
|---|---:|---|
| 528, 529, 563, 565, 607, 609, 792 | TS2352 (×7) | `RuntimeTerminalSummary` cast to `Record<string, unknown>` — missing index signature |
| 570 | TS2322 | `"cancelled"` not in `"failed" \| "success" \| "timeout"` union |
| 614 | TS2820 | `"timed_out"` typo — should be `"timeout"` |
| 665 | TS2322 | `{}` passed where `string` expected |
| 677 | TS2741 | `type` property missing in `SSEEvent` from `Record<string, unknown>` |
| 802 | TS2367 | `"failed"` not in session status discriminant union |

**Risk**: High. SSE poller is the event delivery path. 7 cast errors suggest a systematic issue with `RuntimeTerminalSummary` typing.

**Fix Strategy**:
- Lines 528/529/563/565/607/609/792: Add `as unknown as Record<string, unknown>` two-step cast, OR add index signature to `RuntimeTerminalSummary`
- Line 570: Add `"cancelled"` to terminal status union
- Line 614: Fix typo `"timed_out"` → `"timeout"`
- Line 665: Trace source — fix argument type
- Line 677: Cast `Record<string, unknown>` properly to `SSEEvent` with required `type` field
- Line 802: Add `"failed"` to session status discriminant union

---

### 3.7 `src/services/task-contract/task-contract-builder.ts` — 3 errors

| Line | Code | Issue |
|---|---:|---|
| 493 | TS2345 | `LocalManagerDecision \| null` passed where non-null expected |
| 516, 542 | TS2322 (×2) | `memoryScope: string` vs `MemoryScope` enum — need cast or enum value |

**Risk**: Medium. Null propagation could crash contract building.

**Fix Strategy**:
- Line 493: Add null check before passing `LocalManagerDecision`
- Lines 516/542: Use `as MemoryScope` cast or ensure enum value is assigned

---

### 3.8 `src/services/task-contract/task-contract-types.ts` — 1 error

| Line | Code | Issue |
|---|---:|---|
| 257 | TS2304 | `VerificationMode` not found — import/declaration gap |

**Risk**: Low. Type-only; missing import.

**Fix Strategy**: Import `VerificationMode` from the correct module, or declare if it's a local type.

---

### 3.9 `src/services/verifier/contract-verifier.ts` — 1 error

| Line | Code | Issue |
|---|---:|---|
| 24 | TS2459 | `VerificationResult` import from `./artifact-verifier.js` not exported |

**Risk**: Low. Export gap in adjacent module.

**Fix Strategy**: Add `export` to `VerificationResult` in `artifact-verifier.ts`.

---

## 4. Fix Strategy Summary

| File | Strategy | Expected Behavior Change |
|---|---|---|
| `chat.ts` | Null guards, add missing type properties, fix argument | None — type-only |
| `model-gateway.ts` | Extend enum or remove dead branch | None — type-only |
| `prompts/loader.ts` | Fix function name reference | None — type-only |
| `human-review-service.ts` | Extend error reason union | None — existing values just not in type |
| `llm-native-router.ts` | Null guards, stub Phase 4 imports, fix extraneous field | None — Phase 4 stubs are no-op |
| `sse-poller.ts` | Two-step cast `RuntimeTerminalSummary`, extend unions, fix typo | None — type-only |
| `task-contract-builder.ts` | Null check, MemoryScope cast | None — type-only |
| `task-contract-types.ts` | Import VerificationMode | None — type-only |
| `contract-verifier.ts` | Export VerificationResult | None — add export |

---

## 5. Scope Rules

### Allowed
- Fix type declarations, imports, and exports
- Add null/undefined guards
- Extend union types and enums
- Add type casts where safe
- Create stub files for missing modules (Phase 4 only)
- Fix typos in string literal types

### Prohibited
- No product features
- No S100P behavior changes
- No UI changes
- No Agent Engine / Sandbox / MCP work
- No broad `any` casts unless documented with reason
- No modification to routing logic
- No schema changes

**Reliable Polling Behavior Fixes**: Deferred to **S101R** (`docs/sprints/S101R-reliable-polling-hardening-plan.md`). The following are explicitly excluded from S101T:
- SSE `done` event `stream` protocol changes (C1)
- Watchdog/Poller timeout field unification (C4)
- Poller timeout `task_commands` state updates (C3)
- Worker lifecycle restart fixes (C5)
- Execute worker cancellation/timeout protection (C6)
- `estimateCost` pricing logic (H1)
- Poller timeout config, adaptive polling, dead code cleanup, `markDelivered` behavior

For `sse-poller.ts` specifically: S101T touches are limited to type casts, union extensions, and the `"timed_out"` → `"timeout"` typo fix. No protocol/behavior changes.

**`@ts-expect-error` rule**: Only if absolutely unavoidable (e.g., Phase 4 module doesn't exist yet). Must document why.

---

## 6. Execution Order

| Step | File | Risk | Estimated Time |
|---|---:|---|---|
| 1 | `prompts/loader.ts` | Low | 5 min |
| 2 | `task-contract-types.ts` | Low | 5 min |
| 3 | `contract-verifier.ts` | Low | 5 min |
| 4 | `human-review-service.ts` | Low | 5 min |
| 5 | `model-gateway.ts` | Low | 5 min |
| 6 | `task-contract-builder.ts` | Medium | 10 min |
| 7 | `llm-native-router.ts` | Medium | 20 min |
| 8 | `api/chat.ts` | High | 15 min |
| 9 | `phase3/sse-poller.ts` | High | 25 min |

**Principle**: Low-risk files first to build momentum; high-risk (chat + sse-poller) last with full attention.

---

## 7. Exit Criteria

S101T is complete when:

1. `npx tsc --noEmit` returns **0 errors**
2. Existing S100P smoke scripts (21/21) still pass or are confirmed not impacted
3. No product behavior is intentionally changed
4. All fixes documented by file in completion report
5. No `@ts-expect-error` used without documented justification

---

## 8. Branch

```
s101t-typescript-debt-cleanup
```

Based on S100P final acceptance commit `5a5bdef`.

---

## 9. Risk Register

| Risk | Impact | Mitigation |
|---|---|---|
| Phase 4 stub imports require real module | Low | Create minimal stub index.ts that re-exports or returns empty |
| Fix introducing runtime behavior change | High | Review each non-trivial change; null guard additions are the main area |
| `slowModel` reference — upstream refactor gap | Medium | May require importing from a renamed model module |
| `buildManagerSystemPrompt` — renamed function | Low | Search codebase for actual name |
| SSE event type changes affect streaming | Medium | Ensure cast-only; no event shape changes |
