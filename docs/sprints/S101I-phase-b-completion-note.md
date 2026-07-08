# S101I Phase B Completion Note — E2E Smoke Verification

## 1. Summary

Phase B added two repeatable smoke scripts verifying the Worker execution integration path at the contract level. Together they cover both the backend SSE event contract and the full `command → worker → archive → SSE payload` data path.

## 2. Smoke Coverage

| Segment | Covered? | Method |
|---|---|---|
| command creation (schema) | ✅ PASS | task_commands DDL + CommandStatus type verified |
| worker pickup (loop contract) | ✅ PASS | execute/slow worker start/stop + poll query verified |
| archive write (slow_execution) | ✅ PASS | repo INSERT + UPDATE queries verified |
| SSE payload emission | ✅ PASS | progress/partial_result/done(usage+terminalSummary) events verified |
| frontend event handler contract | ✅ PASS | ChatInterface handles all 4 event types verified |
| frontend type contract | ✅ PASS | StreamEvent type includes all 4 fields verified |
| payload JSON round-trip | ✅ PASS | progress/partial_result/done nodes serializable verified |
| mock execution path E2E | ✅ PASS | Full command → archive → SSE event construction verified |
| browser UI | 🔜 DEFERRED | Phase A displays are correct; live browser E2E left to S101P |

## 3. Files Changed

| File | Change |
|---|---|
| `scripts/smoke/s101i-sse-contract-smoke.mjs` | +241 lines: SSE event type/field/payload contract verification (23 checks) |
| `scripts/smoke/s101i-worker-execution-smoke.mjs` | +282 lines: DB schema + type + worker loop + SSE poller + mock execution path verification (22 checks) |
| `docs/sprints/S101I-phase-b-completion-note.md` | This file |

## 4. Smoke Scripts Detail

### s101i-sse-contract-smoke.mjs

Two modes:
- **Static (default)**: Verifies SSEEvent type union, interface fields, frontend handler coverage, StreamEvent fields, and JSON payload contract — no server needed
- **Live (`--live`)**: Starts backend, sends SSE chat request, parses stream, verifies event structure and Phase A fields

```
Usage:
  node scripts/smoke/s101i-sse-contract-smoke.mjs           # static
  node scripts/smoke/s101i-sse-contract-smoke.mjs --live    # full E2E
```

### s101i-worker-execution-smoke.mjs

Verifies the backend data pipeline statically (no server needed):
- W1: DB schema (task_commands DDL, task_archives columns)
- W2: Type contracts (TaskCommandRecord, CommandStatus, TaskArchiveRecord, TaskState)
- W3: Worker loop contracts (poll queries, start/stop exports)
- W4: SSE poller → archive data path (reads slow_execution, checks delivered, emits done)
- W5: Mock execution path (construct and JSON round-trip the full command → archive → SSE event chain)

```
Usage:
  node scripts/smoke/s101i-worker-execution-smoke.mjs
```

## 5. Verification Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` (backend) | PASS (0 errors) |
| `npx tsc --noEmit` (frontend) | PASS (0 errors) |
| `node scripts/smoke/s101i-sse-contract-smoke.mjs` | 23 PASS / 0 FAIL / 0 SKIP |
| `node scripts/smoke/s101i-worker-execution-smoke.mjs` | 22 PASS / 0 FAIL / 0 SKIP |

## 6. Known Limitations

| Aspect | Limitation |
|---|---|
| DB connection | Static mode — verifies schema and query patterns, not live data |
| Real worker loop | Static mode — verifies start/stop exports and poll queries, not actual loop execution |
| Real SSE stream | Static mode — verifies event type/field/payload contracts; live mode (`--live`) available for real SSE |
| Browser UI | Deferred to future — Phase A already verified display correctness manually |
| Live mode worker events | `--live` sends simple chat; worker delegation (progress/partial_result/usage events) depends on LLM routing decision, thus SKIP-categorized if absent |

## 7. Scope Guard

Not changed:
- Worker business logic
- SSE protocol
- Frontend UI
- Task archive schema
- Pricing
- S101R Batch D
- S101P session detail deepening

## 8. Final Status

```text
S101I Phase B: READY FOR PM REVIEW
```
