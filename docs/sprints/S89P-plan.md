# Sprint 89P — Partial Result Streaming & Early Display V0 — Plan

## Status

**BUILD COMPLETE ✅**

## Baseline

- S88P closure baseline: `960f2e3`
- Repository HEAD: `abaf73c`

## Goal

Expose safe partial worker results through existing SSE paths so users can see useful progress before final synthesis/completion finishes.

## Non-goals (all respected)

- No UI dashboard
- No semantic cache
- No fast path expansion
- No synthesis skip expansion
- No planner rewrite
- No Human Review / Resume semantic changes
- No prompt/content capture beyond already user-visible worker output
- No change to final result contract

## Key Design

### Partial Result Flow

```
Worker (Cycle Runtime executeWorker callback)
  │  each callModelFull("worker") completes
  ▼
TaskArchiveRepo.appendPartialResult(archive_id, { index, content, timestamp })
  │  appends to slow_execution.partialResults[] JSONB array
  ▼
SSE Poller (pollArchiveAndYield)
  │  detects new partialResults with index > lastEmittedPartialIndex
  │  during executing/delegated/waiting_result/synthesizing states
  ▼
yield { type: "partial_result", partialResult: { index, content, isPartial: true } }
  │  content is truncated to PARTIAL_RESULT_MAX_LENGTH (500 chars) for SSE
  ▼
Frontend receives early preview while Worker continues
```

### Privacy Boundary

- `partial_result` event exposes only: `index`, `content` (truncated), `cycleIndex?`, `timestamp`, `isPartial`
- Does NOT expose: prompt, messages, system prompt, tool calls, tool arguments, API keys, user data, history, model name
- Content is always truncated to 500 chars max for SSE payload

### SSE Compatibility

- `"partial_result"` is a new additive event type
- Does NOT change existing `result`, `error`, `done`, `chunk`, `progress`, `cycle_event` shapes
- Legacy clients can safely ignore unknown `"partial_result"` events
- Final result contract unchanged

### V0 Limitations

- Only Cycle Runtime path emits partial results (not fast path or legacy path)
- Partial results are worker-presentable text only — no structured data
- Content is truncated to 500 chars in SSE (full content available in archive)

## Modified Files

| File | Change |
|------|--------|
| `src/types/runtime-trace.ts` | Added `PartialResult` type, `PARTIAL_RESULT_MAX_LENGTH`, `truncatePartialContent()` |
| `src/db/task-archive-repo.ts` | Added `appendPartialResult()` method |
| `src/services/phase3/sse-poller.ts` | Added `"partial_result"` to SSEEvent union, partial result detection + emission logic |
| `src/services/phase3/slow-worker-loop.ts` | Added `appendPartialResult` call in Cycle Runtime executeWorker callback |

## New Files

| File | Description |
|------|-------------|
| `tests/services/s89p-partial-result.test.ts` | 41 tests |
| `vitest.s89p.config.ts` | Vitest config |
| `docs/sprints/S89P-plan.md` | This file |

## Validation

| Test Suite | Result |
|------------|--------|
| S89P targeted | 41/41 PASS ✅ |
| S88P | 44/44 PASS ✅ |
| S87P | 52/52 PASS ✅ |
| S86P | 33/33 PASS ✅ |
| S85P | 105/105 PASS ✅ |
| S75P–S84P non-DB/unit | PASS ✅ |
| DB-backed E2E | BLOCKED (PostgreSQL unavailable) |
| **No S89P-introduced regressions** | ✅ |
