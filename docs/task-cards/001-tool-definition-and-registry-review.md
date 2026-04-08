# EL-001 Review: Tool Definition + Registry

**Task Card:** EL-001
**Sprint:** 05 — Execution Loop / Tool Actions
**Status:** ✅ Done
**Commit:** _(pending)_

---

## What was built

### New files

| File | Purpose |
|---|---|
| `backend/src/tools/definitions.ts` | Built-in tool definitions (6 tools) |
| `backend/src/tools/registry.ts` | `ToolRegistry` class + singleton |
| `backend/src/tools/executor.ts` | `ToolExecutor` class + internal handlers |

### Modified files

| File | Change |
|---|---|
| `backend/src/types/index.ts` | Added: `ToolScope`, `ToolParameter`, `ToolDefinition`, `ToolCall`, `ToolResult`, `ExecutionStep`, `ExecutionPlan` |

---

## Tool Ecosystem (v1)

### Internal tools (always available)

| Tool | Purpose |
|---|---|
| `memory_search` | Search user memory via v2 retrieval pipeline, returns ranked results with relevance scores |
| `task_read` | Read a task's current state and summary |
| `task_update` | Update task status, append completed steps |
| `task_create` | Create a new sub-task under the current session |

### External tools (require ToolGuardrail approval — EL-004)

| Tool | Purpose |
|---|---|
| `http_request` | GET to whitelisted external APIs |
| `web_search` | Web search via configured provider |

---

## Key design decisions

### 1. Registry is a singleton
`toolRegistry` is instantiated once at module load and exported. All consumers import from `registry.ts`. This avoids re-registration noise and ensures consistent tool state across the process.

### 2. External tools are stubbed in executor
`handleExternalStub()` throws if called directly, directing callers to use the ExecutionLoop. The actual HTTP execution will live in EL-003/EL-004.

### 3. Function Calling schema export
`toolRegistry.getFunctionCallingSchemas()` returns OpenAI-formatted tool objects. Consumed by the ExecutionLoop in EL-003 when calling the model with tools.

### 4. Type coverage
All new types (`ToolDefinition`, `ToolCall`, `ToolResult`, `ExecutionStep`, `ExecutionPlan`) are exported from `types/index.ts` alongside existing Memory v2 types. No new enums added; `ToolScope` is a simple string union.

### 5. `memory_search` uses v2 retrieval
The `memory_search` handler calls `runRetrievalPipeline()` directly, reusing the v2 scoring model (importance + recency + keyword relevance). Tool results are ranked by relevance, not raw recency.

---

## Acceptance checklist

- [x] `ToolDefinition` + `ToolCall` + `ToolResult` types in `types/index.ts`
- [x] `ToolRegistry` with `register()`, `getTool()`, `listTools()`, `getFunctionCallingSchemas()`
- [x] All 6 built-in tools registered at startup
- [x] `memory_search` handler returns ranked memory results
- [x] `task_read/update/create` handlers implemented
- [x] External tools stubbed (will be wired in EL-003/EL-004)
- [x] `npx tsc --noEmit` passes with zero errors

---

## Dependencies

- `types/index.ts` (modified) — new tool types
- `db/repositories.ts` — `MemoryEntryRepo`, `TaskRepo`
- `config.ts` — `memory.retrieval.categoryPolicy` for `memory_search` handler
- `services/memory-retrieval.ts` — `runRetrievalPipeline` for `memory_search`

---

## Deferred

- HTTP execution for `http_request` / `web_search` → EL-003/EL-004
- Tool call result persistence to `memory_entries` → future card
- Dynamic tool registration (runtime) → future card
