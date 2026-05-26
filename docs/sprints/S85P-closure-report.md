# Sprint 85P — Closure Report

## LLM Round Trip Reduction / Simple Task Fast Path V0

| Field | Value |
|---|---|
| Sprint | 85P |
| Baseline Commit | 2107e62 (S84P closure) |
| Status | **BUILD COMPLETE** |
| Date | 2026-05-26 |
| Config | `vitest.s85p.config.ts` |

---

## Key Design Clarification

S84P found that local verifier execution is **not** the bottleneck.
S85P therefore does **not** optimize local verifier code.

Instead, S85P introduces a **conservative fast path** that bypasses cycle runtime for eligible low-risk simple tasks, preventing additional cycle-driven Worker calls such as revise/rewrite retries.

The fast path still performs a **single Worker call** and **local artifact verification**.

---

## What S85P Does

- **Bypasses cycle runtime** for conservatively eligible simple tasks
- **Guarantees single Worker LLM call** (no revise/rewrite retries)
- Classifies tasks using **8-layer conservative check**, all local + deterministic
- Records `fastPath` metadata in `RuntimeTrace` for observability
- Early-return pattern in `slow-worker-loop.ts`: self-contained, no normal path changes

## What S85P Does NOT Do

- Does **not** skip artifact verifier (`verifyArtifact` still runs on fast path)
- Does **not** remove verifier globally
- Does **not** change Human Review / Confirmation semantics
- Does **not** skip contract verification for tasks that have criteria (V0: criteria must be 0)
- Does **not** bypass high-risk tasks (15 keywords block fast path)
- Does **not** bypass compliance tasks (13 keywords block fast path)
- Does **not** bypass human_review signals
- Does **not** fast-path tasks with tool calls, side effects, or revision context
- Does **not** introduce any LLM call for classification itself

---

## Deliverables

| ID | Deliverable | Status |
|---|---|---|
| D1 | `SimpleTaskClassifier` V0 (`classifySimpleTask`) | ✅ |
| D2 | Conservative eligibility rules (8-layer, MAX_PROMPT_LENGTH=2000, MAX_SIMPLE_CRITERIA=0) | ✅ |
| D3 | Fast path early-return in `slow-worker-loop.ts` (skip cycle, single Worker call) | ✅ |
| D4 | `RuntimeTrace.fastPath` metadata | ✅ |
| D5 | Benchmark: classification speed ~2.75µs avg | ✅ |
| D6 | Safety boundary tests (55 keywords iterated) | ✅ |
| D7 | S75P–S84P regression (unit pass; DB-backed E2E blocked — PostgreSQL unavailable) | ✅ (conditional) |

---

## Eligibility Rules (V0 — Conservative)

Tasks are eligible for fast path only when **all** of these hold:

1. `hasToolCalls !== true`
2. `hasExternalSideEffects !== true`
3. `isRevisionTask !== true`
4. `promptLength <= 2000` chars
5. **`criteriaCount === 0`** (V0: no sections or constraints allowed)
6. No high-risk keyword (security, vulnerability, exploit, password, secret, token, destructive, etc.)
7. No compliance keyword (GDPR, HIPAA, medical, legal, financial, payment, PII, etc.)
8. No human_review signal

**Any single veto → ineligible.** Classification is zero-cost: local string matching, ~2.75µs average.

### Why criteriaCount === 0?

PM directive (2026-05-26):
> V0 先证明 fast path 机制可行；不要在第一版跳过 contract verification.
> 后续 S86P 可以做 simple criteria classifier.

This is the most conservative setting. Future sprints may relax this based on criteria type classification.

---

## Fast Path Execution Flow

```
classifySimpleTask(input)
  ├─ eligible? ──YES──▶ callModelFull(slowModel, messages)  // single Worker call
  │                       ├─ verifyArtifact(content)          // basic artifact check
  │                       ├─ write WorkerResult + Archive (fastPath metadata)
  │                       ├─ update command status → completed
  │                       └─ RETURN (early)                   // skip cycle entirely
  │
  └─ NO ──▶ normal path (cycle runtime or legacy)
              ├─ runCycle() → possible revise/rewrite Worker calls
              ├─ contract verification
              ├─ patch logic
              └─ ... full normal flow
```

### What fast path writes (completeness check)

| Field | Fast Path | Normal Path |
|---|---|---|
| `slow_execution.result` | ✅ | ✅ |
| `slow_execution.verification` | ✅ (basic) | ✅ |
| `slow_execution.fastPath` metadata | ✅ | ❌ |
| `slow_execution.workerStageTimings` | ✅ | ✅ |
| `task_worker_results` | ✅ | ✅ |
| `command.status = completed` | ✅ | ✅ |
| `archive.state = completed` (via `updateStateWithIntegrity`) | ✅ | ✅ |
| `CALL_LEDGER_WORKER` log | ✅ | ✅ |
| `inputTokens/outputTokens/costUsd` | ✅ | ✅ |
| `duration_ms/completed_at` | ✅ | ✅ |
| Error handling → `command.status = failed` | ✅ | ✅ |

---

## Files Changed

### New Files
| File | Purpose |
|---|---|
| `src/types/simple-task-classifier.ts` | Types: SimpleTaskClassification, keywords, defaults |
| `src/services/simple-task-classifier.ts` | `classifySimpleTask()` — 8-layer classifier |
| `tests/services/simple-task-classifier.test.ts` | 33 unit tests |
| `tests/services/s85p-fast-path-boundary.test.ts` | 55 safety boundary tests |
| `tests/benchmark/s85p-fast-path-benchmark.test.ts` | 17 benchmark tests |
| `vitest.s85p.config.ts` | S85P vitest config |
| `docs/sprints/S85P-plan.md` | Sprint plan |
| `docs/sprints/S85P-closure-report.md` | This report |

### Modified Files
| File | Change |
|---|---|
| `src/services/phase3/slow-worker-loop.ts` | Fast path early-return block (lines 268–414) |
| `src/types/runtime-trace.ts` | `RuntimeTraceFastPath` interface + `fastPath` field on `RuntimeTrace` |
| `src/services/runtime-trace.ts` | `updateTraceFastPath()` helper |

---


## Validation Summary

| Scope | Result | Notes |
|---|---:|---|
| S85P targeted | 105/105 PASS | ✅ |
| S75P–S84P unit regression | PASS | ✅ |
| DB-backed E2E regression | BLOCKED | PostgreSQL unavailable |

### S85P Targeted Tests
```
✓ tests/services/simple-task-classifier.test.ts     33 tests
✓ tests/services/s85p-fast-path-boundary.test.ts    55 tests
✓ tests/benchmark/s85p-fast-path-benchmark.test.ts  17 tests
─────────────────────────────────────────────────────────
  3 files | 105 tests | ALL PASS ✅
```

### S75P–S84P Unit Regression
```
  S84P: 157/187 PASS  (30 failed: 7 E2E files, DB unavailable)
  S83P: 128/158 PASS  (30 failed: 7 E2E files, DB unavailable)
  S82P: 112/137 PASS  (25 failed: 6 E2E files, DB unavailable)
  S81P: 100/121 PASS  (21 failed: 5 E2E files, DB unavailable)
  S80P:  81/96  PASS  (15 failed: 4 E2E files, DB unavailable)
  S79P:  66/77  PASS  (11 failed: 3 E2E files, DB unavailable)
  S78P:  54/61  PASS  ( 7 failed: 2 E2E files, DB unavailable)
  S77P:  17/19  PASS  ( 2 failed: 1 E2E file,  DB unavailable)
  S76P:   9/9   PASS  ✅
  S75P:  16/16  PASS  ✅
─────────────────────────────────────────────────────────
  All unit tests PASS — zero S85P-introduced regressions.
```

### DB-backed E2E Validation Note

S75P–S84P unit regression passed with no S85P-introduced failures.

Database-backed E2E suites were not executable in the current local environment because PostgreSQL was unavailable. All failing suites failed with:

```
AggregateError: Failed to get pool
```

These failures are environment-related and pre-existing for DB-backed E2E suites (`*-e2e.test.ts`), not caused by S85P code changes.

S85P final closure should be considered functionally approved with E2E validation deferred to an environment with PostgreSQL available.

---

## PM Review Checklist

### 3.1 Fast Path reduces LLM round trips?
✅ Corrected. `estimatedRoundTripsSaved` = conservative estimate of prevented cycle-driven Worker calls. Actual saved calls may be 0 if normal cycle would not retrigger. Language updated in comments and closure report.

### 3.2 Contract verification not skipped improperly?
✅ Confirmed. V0 rule: `criteriaCount === 0` eligible. Any sections or constraints → `has_verification_criteria` → ineligible. Fast path NEVER skips contract verification for tasks that have criteria.

### 3.3 FastPath metadata is safe for trace extract?
✅ Confirmed. `RuntimeTraceFastPath` only contains: `eligible`, `used`, `reasonCode`, `skippedStages`, `estimatedRoundTripsSaved`. No raw prompt, artifact, criteria text, or user content.

### 3.4 Early return writes all required fields?
✅ Confirmed (see completeness table above). Archive, verification, ledger log, command status, error handling all present. Falls through to normal path error handler on failure.

### 3.5 Boundary: high-risk tasks never fast-path?
✅ Confirmed. 55 boundary tests cover all keyword categories including newly added: `vulnerabilities`, `destructive`, `payment`.

---

## Estimated Impact

| Metric | Estimate |
|---|---|
| Classification latency | ~2.75µs (negligible) |
| Fast path hit rate | Conservative — V0 with criteriaCount=0 will have limited hits |
| LLM calls saved per eligible task | 0–1+ (prevents cycle-driven revise/rewrite) |
| Fast path Worker Latency | ~single Worker call + basic verifier (no cycle overhead) |
| Risk of false-positive fast path | Near-zero — 8-layer veto, keyword-first blocking |

---

## Next Steps / S86P Recommendations

- Relax criteria rule: classify simple/checkable criteria types → allow up to 3 low-risk criteria
- Instrument live LLM call counts to measure actual `estimatedRoundTripsSaved`
- Consider fast path for tasks with `hasToolCalls=false` + only read-only side effects
- Measure fast path hit rate in production with `RuntimeTrace.fastPath` telemetry
