# Sprint 85P — LLM Round Trip Reduction / Simple Task Fast Path V0

## Goal

Reduce unnecessary LLM round trips for low-risk simple tasks by introducing a conservative fast path that skips the cycle runtime and contract verification.

## Starting Baseline

- S84P closure baseline: `2107e62`
- S84P finding: LLM/external I/O accounts for 70–90% of latency.

## Non-goals

- No Human Review governance expansion.
- No confirmation SSE.
- No permission/RBAC.
- No revise/rewrite resume.
- No full caching platform.
- No broad runtime rewrite.
- No high-risk verifier bypass.
- No semantic changes to S83P confirmation.

## Deliverables

### D1: SimpleTaskClassifier V0

Classify tasks as eligible or ineligible for fast path.

File: `src/services/simple-task-classifier.ts`
Types: `src/types/simple-task-classifier.ts`

### D2: Conservative eligibility rules

Eligible only when ALL of:
- No tool calls
- No external side effects
- Not a revision task
- Short prompt (≤ 2000 chars total)
- Limited criteria (≤ 3 sections + constraints)
- No high-risk keywords (security, vulnerability, password, etc.)
- No security/compliance keywords (GDPR, HIPAA, medical, legal, etc.)
- No human review signals

### D3: Fast path execution

For eligible simple tasks in `slow-worker-loop.ts`:
- Single Worker LLM call (skip cycle runtime entirely)
- Run only `verifyArtifact()` (basic artifact verifier)
- Skip `verifyAgainstCriteria()` (contract verification)
- Early return after completion

### D4: RuntimeTrace fastPath metadata

Added to `RuntimeTrace` and `RuntimeTraceExtract`:
- `eligible: boolean`
- `used: boolean`
- `reasonCode: string`
- `skippedStages: string[]`
- `estimatedRoundTripsSaved: number`

### D5: Benchmark before/after

File: `tests/benchmark/s85p-fast-path-benchmark.test.ts`
- 6 simple benchmarks (all eligible)
- 6 complex benchmarks (all ineligible)
- Classification speed benchmarks (sub-ms)
- Round trip savings estimation

### D6: Safety tests

File: `tests/services/s85p-fast-path-boundary.test.ts`
- All high-risk keywords block fast path
- All security/compliance keywords block fast path
- All human review signals block fast path
- Revision tasks always ineligible
- Tool/side-effect combinations blocked
- False positive prevention verified

### D7: Regression

Run S75P–S84P regression.
Config: `vitest.s85p.config.ts`

## Success Criteria

- [ ] At least one simple benchmark reduces LLM round trips (via cycle skip)
- [ ] High-risk/tool/ambiguous tasks do not use fast path
- [ ] RuntimeTrace records fastPath metadata
- [ ] Classification speed < 500us avg
- [ ] All S85P unit tests pass
- [ ] Regression remains green (S75P–S84P)

## Design Decisions

### Why skip cycle runtime entirely?

The cycle runtime's primary value is contract-aware verification with rewrite/revision loops. For simple tasks with no tools, no side effects, and low risk:
- There are no verification criteria to check
- There's no need for rewrite cycles
- A single Worker call + basic format verification is sufficient

### Why is the verifier still run?

`verifyArtifact()` is a local deterministic checker (sub-ms, zero LLM calls) that validates:
- Content is non-empty
- No security violations
- Basic format checks
This is cheap insurance and provides valuable metadata.

### Why are the rules so conservative?

The classifier is designed to be strict:
- Better to reject a simple task than to fast-path a risky one
- All checks are local and deterministic (no LLM needed)
- One veto → ineligible (no scoring/weighting)
- Keywords are substring-matched case-insensitively

## Files Changed

```
src/services/simple-task-classifier.ts       (new)
src/types/simple-task-classifier.ts          (new)
src/services/phase3/slow-worker-loop.ts      (modified — fast path block)
src/types/runtime-trace.ts                   (modified — fastPath field)
src/services/runtime-trace.ts                (modified — updateTraceFastPath)
tests/services/simple-task-classifier.test.ts (new)
tests/services/s85p-fast-path-boundary.test.ts (new)
tests/benchmark/s85p-fast-path-benchmark.test.ts (new)
vitest.s85p.config.ts                        (new)
docs/sprints/S85P-plan.md                    (this file)
```
