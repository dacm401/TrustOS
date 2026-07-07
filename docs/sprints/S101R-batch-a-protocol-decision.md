# S101R Batch A Protocol Decision — SSE done event

## 1. Decision Context

Based on:
- `docs/reviews/phase3-reliable-polling-review.md` (C1: `done.stream` protocol violation)
- `docs/SSE-EVENT-PROTOCOL-v1.md` (FROZEN protocol spec)
- `docs/SSE-DONE-FIELD-AUDIT.md` (S67P field inventory)

**Problem**: SSE protocol v1 defines `done` as a pure terminal signal without `stream`. But the actual code emits `done.stream` in 12 locations across `chat.ts` and `sse-poller.ts`.

## 2. Current Protocol Rule

From `SSE-EVENT-PROTOCOL-v1.md`:

| Event | type | stream | routing_layer | Purpose |
|---|---|---|---|---|
| `done` | `"done"` | **无** | inherited | 流结束，无 payload |

Official payload:

```typescript
// done（无 stream 字段）
{ type: "done", routing_layer: string }
```

**Key rule**: "`done` 事件无 `stream` 字段 — done 是纯终止信号，不携带数据"

**Forbidden**: "禁止在 `done` 事件中携带 `stream` 字段"

## 3. Code Audit

### 3.1 Source: `src/api/chat.ts` — 5 done emissions with `stream`

| Line | Context | `stream` value | Notes |
|---|---|---|---|
| ~232 | Quick intent (date/time) | `"已返回答案"` / `"Answer ready"` | Fast path, L0 |
| ~266 | Quick intent (variant) | `"已返回答案"` / `"Answer ready"` | Fast path, L0 |
| ~381 | LLM direct answer (no delegation) | `"已返回答案"` / `"Answer ready"` | L0 |
| ~498 | Delegation trigger failed | `"任务失败"` / `"Task failed"` | Error short-circuit |
| ~769 | **Primary done payload** | `"✅ 完成"` / `"✅ Done"` or `"已返回答案"` | Carries ledger, budget, verification, qualityRouting, contextPackage, cost, runtimeTrace, etc. |

### 3.2 Source: `src/services/phase3/sse-poller.ts` — 7 done emissions with `stream`

| Line | Context | `stream` value | Notes |
|---|---|---|---|
| ~396 | DB error state | `"执行失败"` / `"Execution failed"` | L2 |
| ~529 | Worker failed | `"执行失败"` / `"Execution failed"` | L2, has terminalSummary |
| ~565 | Cancelled | `"已取消"` / `"Cancelled"` | L2, has terminalSummary |
| ~609 | Timed out | `"已超时"` / `"Timed out"` | L2, has terminalSummary |
| ~792 | Completed successfully | `"分析完成"` / `"Analysis complete"` | L2, has terminalSummary + usage |
| ~818 | Archive with errors | `"执行失败"` / `"Execution failed"` | L2 |
| ~857 | Poller timeout | `"任务超时"` / `"Task timed out"` | L2 |

### 3.3 Frontend: `frontend/src/components/chat/ChatInterface.tsx`

Handles `done` event at line ~186:

```typescript
} else if (data.type === "done") {
    setThinkingState("completed");
    setStatusMsg(null);
    if (data.task_id) {
        onTaskIdChange?.(data.task_id);
        setActiveTaskId(data.task_id);
    }
    // Updates message metadata — does NOT read data.stream
    const inferredMeta = inferMetaFromStreamEvent(data);
    setMessages((prev) =>
        prev.map((m) =>
            m.id === placeholderId
                ? { ...m, streaming: false, decision: data.decision, ... }
                : m
        )
    );
}
```

**Frontend does NOT consume `done.stream`.** ✅

### 3.4 Tests / Scripts

No smoke test, benchmark script, or harness reads `done.stream` from SSE output. ✅

### 3.5 `SSE-DONE-FIELD-AUDIT.md` (S67P)

This document captured the **actual** done payload structure including `stream` as a field-inventory exercise, not a protocol compliance check. It documents what the code currently emits, not what the protocol mandates.

## 4. Options

| Option | Description | Pros | Cons | Recommendation |
|---|---|---|---|---|
| **A** | Keep protocol v1, remove `done.stream` | Protocol-compliant; clean separation of concerns; frontend already compatible | Requires changes in 12 yield locations across 2 files | ✅ **Recommended** |
| **B** | Upgrade protocol to v2, allow `done.stream` | Minimal code change; preserves existing diff behavior | Breaks v1 semantics; done becomes content carrier — anti-pattern; requires re-freeze | ❌ Not preferred |

## 5. Recommended Decision

```text
Keep SSE protocol v1 (FROZEN).
Remove `stream` field from ALL `done` events.
Do not use `done` as a content carrier.
```

### Rationale

1. **Protocol already frozen**: `SSE-EVENT-PROTOCOL-v1.md` is explicit — `done` is a pure terminal signal. The protocol was correct; the code drifted.
2. **Frontend is already compatible**: `ChatInterface.tsx` handles `done` by setting `thinkingState: "completed"` and stopping the loading spinner. It never reads `data.stream` from done events.
3. **Content has dedicated channels**: Final results go through `result` / `manager_synthesized`. Errors go through `error`. Status goes through `status`. `done` should only signal stream end.
4. **No test dependency**: Zero test/script references to `done.stream`.
5. **S101T already blazed the trail**: The `RuntimeTerminalSummary → Record` casts in `sse-poller.ts` already decouple the terminal summary from `done.stream` — `terminalSummary` is available via `done.terminalSummary` for diagnostic use.

### What `done` should carry (protocol v1)

```typescript
{
  type: "done",
  routing_layer: string,
  // Optional: non-content metadata the frontend may need
  task_id?: string,
  ledger?: LedgerPayload,
  artifactMeta?: ArtifactMeta | null,
  meta?: { origin: string, contentKind: string },
  cost?: CostPayload,
  budget?: BudgetPayload,
  verification?: VerificationPayload,
  qualityRouting?: QualityRoutingPayload,
  contextPackage?: ContextPackageV1 | null,
  runtimeTrace?: RuntimeTraceExtract | null,
  terminalSummary?: Record<string, unknown>, // diagnostic only
  usage?: Record<string, unknown>,           // diagnostic only
}
```

### What `done` should NOT carry

```typescript
stream: string  // ← REMOVE
```

## 6. Required Implementation Scope

| File | Locations | Change |
|---|---|---|
| `src/api/chat.ts` | 5 locations (lines ~232, ~266, ~381, ~498, ~769) | Remove `stream:` field from each `done` object |
| `src/services/phase3/sse-poller.ts` | 7 locations (lines ~396, ~529, ~565, ~609, ~792, ~818, ~857) | Remove `stream:` field from each `done` yield |

**Total**: 12 line-level removals across 2 files. Zero frontend changes. Zero test changes.

## 7. Verification Plan

| Check | Method | Expected |
|---|---|---|
| SSE protocol smoke | Send request, capture SSE events | `done` event has no `stream` field |
| Frontend stream rendering | Chat UI after delegation | Loading spinner stops; final content from `result`/`manager_synthesized` still displayed |
| `npx tsc --noEmit` | TypeScript check | 0 errors |
| S100P smoke scripts | Existing smoke suite | No regression |
| `done.terminalSummary` preserved | Diagnostic path check | `terminalSummary` still present on done events where applicable |

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Consumer reads `done.stream` as fallback content | Low | Medium | Audit confirmed no consumers; second audit at implementation time |
| Test expects `done.stream` in output | Low | Low | No test references found; smoke suites use `result`/`error` events, not `done.stream` |
| Legacy SSE path divergence | Low | Medium | Both Phase 3.0 and Legacy SSE paths emit `done.stream`; both will be fixed |

## 9. Decision Status

```text
Decision: Option A — Keep protocol v1, remove done.stream
Status: PLANNING / PENDING PM APPROVAL
Code changes: NOT STARTED (deferred to S101R Batch A implementation)
```

---

*Protocol decision prepared 2026-07-07. Awaiting PM approval before Batch A implementation.*
