# S101P Phase B Brief — Manager Workspace Execution Visibility

**Status:** PLANNING ONLY (no implementation)
**Predecessor:** S101P Phase A (ACCEPTED, 7f4164f)

---

## 1. Background

S101P Phase A fixed message-level execution visibility in ChatInterface:
- **A1**: `terminalSummary` human-readable parsing + expand/collapse via `formatTerminalSummary()`
- **A2**: `usage` unconditional display with token breakdown `{input}↑ {output}↓ {total}Σ`
- **A3**: `executionProgress` persisted on assistant messages; compact status line shown post-stream

These changes live entirely in `MessageBubble.tsx` and `ChatInterface.tsx`. Phase B evaluates how to bring similar execution visibility into **ManagerConversation** and **SessionDetail** — the two remaining user-facing surfaces in the Manager Workspace.

---

## 2. Current Component Audit

### 2.1 ManagerConversation (`frontend/src/components/manager-workspace/ManagerConversation.tsx`)

**Data Model (`DisplayMessage`, lines 7–13):**

| Field | Type | Description |
|---|---|---|
| `id` | `string` | Message ID |
| `role` | `"user" \| "manager" \| "system"` | Message role (note: uses `"manager"`, not `"assistant"`) |
| `content` | `string` | Plain text body |
| `relatedSessionId` | `string?` | Links to delegated AgentSession |
| `createdAt` | `string` | ISO timestamp |

**Backend API:** `POST /v1/manager/route-message` → `RouteMessageResponse`:
```
{ routeType, targetSessionId, clarificationRequired, reason, 
  managerMessage: ManagerMessage, createdSession: AgentSession | null, 
  sessionEvent: SessionEvent | null }
```

`ManagerMessage` has only: `id, user_id, conversation_id, role, content, related_session_id?, created_at`

**Rendering:**
- Pure inline JSX (no reusable bubble component)
- Displays: content text, "查看任务 →" button (when relatedSessionId exists), timestamp
- No: avatar, code highlighting, decision card, usage, terminalSummary, executionProgress, feedback, delegation status

**Gap Summary:**
- **No execution visibility whatsoever.** The Manager responds with natural-language routing explanations, but never shows what happened inside the Worker execution.

### 2.2 MessageBubble (`frontend/src/components/chat/MessageBubble.tsx`)

**Props (`MessageBubbleProps`, lines 10–29):**

| Prop | Type | Required? |
|---|---|---|
| `role` | `"user" \| "assistant"` | Yes |
| `content` | `string` | Yes |
| `decision` | `Decision` | No |
| `userId` | `string` | No (default: `"dev-user"`) |
| `delegation` | `{ status, slow_result?, error? }` | No |
| `routingLayer` | `"L0" \| "L1" \| "L2" \| "L3"` | No |
| `usage` | `UsageInfo` | No |
| `terminalSummary` | `unknown` | No |
| `executionProgress` | `ExecutionProgress` | No |

**Coupling Analysis:**
MessageBubble is **tightly coupled to ChatInterface's message model**, not a generic component:

1. **Role type mismatch**: expects `"assistant"`, Manager uses `"manager"`
2. **Decision dependency**: thumbs-up/down feedback calls `sendFeedback(decision.id, ...)`. Without a `decision` prop, feedback is entirely skipped. The metadata row (model name, legacy token display, latency) also depends on `decision.execution`.
3. **Delegation prop**: expects SSE-specific status enum `"pending" | "completed" | "failed"`. Manager has its own delegation model (via `routeType`).
4. **Feedback UI**: permanently rendered when `decision` is present. Not appropriate for Manager workspace.
5. **ActionBar**: copy/regenerate/continue actions with `isArtifact` detection — ChatInterface-specific workflow.
6. **ResultDisplay**: CodeBlock + PreviewPane for React/TSX/HTML content — not needed in Manager.
7. **Avatar**: styled for `"你"` / `"TrustOS"` labels — Manager would need `"Manager"`.

**Key helpers inside MessageBubble (not exported):**
- `formatTerminalSummary(raw)` — lines 43–76, module-private
- `LAYER_COLORS` mapping — lines 32–37, module-private
- `ResultDisplay` — lines 465–497, module-private

### 2.3 SessionDetail (`frontend/src/components/manager-workspace/SessionDetail.tsx`)

**Data Model:**

| Source | Type | Key Fields |
|---|---|---|
| `fetchAgentSessionDetail` | `AgentSession` | id, title, goal, status, worker_id, delegation_contract, risk_level, timestamps |
| `fetchSessionEvents` | `SessionEvent[]` | id, session_id, type (40 types), summary, severity, visibility, raw_ref, created_at |

**Backend APIs:**
- `GET /v1/agent-sessions/:id` → `{ session: AgentSessionRecord }`
- `GET /v1/session-events?sessionId=X&limit=200` → `{ events: SessionEventRecord[], total }`

**40 Event Types (full list):**
7 lifecycle · 4 delegation · 6 worker · 3 tool · 4 permission · 2 message · 2 user-input · 4 plan · 3 decision · 3 risk · 2 diagnostic

**Current rendering:**
- Session header: title, status badge, goal, risk_level, delegation_contract summary
- Events timeline: icon + type + visibility badge + summary + timestamp (sorted newest-first)

**Missing execution data:**
- `usage` / tokens / cost — **not in AgentSession schema, not in any API response**
- `terminalSummary` — **not persisted to agent_sessions table**
- `executionProgress` — **not persisted to agent_sessions table**
- `decision` / routing — **not in AgentSession schema**
- `runtimeTrace` (stage timings, worker summary, LLM calls) — **type exists in `runtime-trace.ts` but not exposed via SessionDetail API**

**Data availability is the blocker for SessionDetail.** The SSE stream delivers `usage`/`terminalSummary`/`executionProgress` to ChatInterface in real-time, but these are never persisted to `agent_sessions` or exposed through the session detail API. Without backend changes, SessionDetail **cannot** display execution metadata.

---

## 3. Data Model Comparison

| Field | ChatInterface `Message` | ManagerConversation `DisplayMessage` | SessionDetail Data | Notes |
|---|---|---|---|---|
| `usage` (UsageInfo) | ✅ from SSE `done` event | ❌ | ❌ not in AgentSession table | Only ChatInterface has it |
| `terminalSummary` (unknown) | ✅ from SSE `done` event | ❌ | ❌ not in AgentSession table | Only ChatInterface has it |
| `executionProgress` (ExecutionProgress) | ✅ from SSE `progress`/`done` events | ❌ | ❌ not in AgentSession table | Only ChatInterface has it |
| `decision` (Decision) | ✅ from SSE events | ❌ | ❌ not in AgentSession table | ChatInterface-specific |
| `delegation` | ✅ from SSE `status` events | ❌ (different model via `routeType`) | ✅ delegation event types | Different abstraction levels |
| `routing_layer` | ✅ L0/L1/L2/L3 | ❌ | ❌ | ChatInterface routing |
| `relatedSessionId` | ❌ | ✅ links to AgentSession | ✅ native (`session_id`) | Manager-specific |
| `content` | ✅ | ✅ | ❌ (events have `summary`) | Universal |
| `role` | `"user" \| "assistant"` | `"user" \| "manager" \| "system"` | N/A | Incompatible |

**Key finding:** The ChatInterface message model and the ManagerConversation/SessionDetail data models are **completely separate data flows** with no shared persistence layer for execution metadata. ChatInterface receives rich SSE events but discards them when the page refreshes. SessionDetail fetches from a relational DB (agent_sessions + session_events) that never receives execution metadata.

---

## 4. Reuse Strategy Options (ManagerConversation)

### Option A: Reuse MessageBubble Directly

**What it means:** Pass ManagerConversation messages through the existing `MessageBubble` component.

**Assessment:**

| Factor | Score | Detail |
|---|---|---|
| Code reuse | ❌ LOW | Would need to mock/shim `decision`, `userId`, `delegation`, `routingLayer`, feedback handlers. >60% of MessageBubble's rendering tree becomes dead code. |
| Role compatibility | ❌ FAIL | MessageBubble only accepts `"user" \| "assistant"`. Manager uses `"manager"`. Would require type change + avatar logic change. |
| Feedback leakage | ❌ FAIL | The thumbs-up/down UI appears whenever `decision` is present. No way to suppress without a new prop. |
| DecisionCard | ❌ NOISE | Shows routing decision card — irrelevant to Manager workspace. |
| ActionBar | ❌ NOISE | Copy/regenerate/continue actions — ChatInterface-specific workflow. |
| ResultDisplay | ❌ NOISE | CodeBlock + PreviewPane for artifact content — not applicable. |
| Scope risk | 🔴 HIGH | Would force MessageBubble refactoring (add conditional rendering, new role type, suppress features). Risks regression in ChatInterface. |

**Verdict: NOT RECOMMENDED.** MessageBubble is a ChatInterface-specific component. Forcing it into ManagerConversation would create more complexity than value.

### Option B: Extract Lightweight `ExecutionMetadata` Component (RECOMMENDED)

**What it means:** Extract a new shared component that renders only the execution visibility data (usage, terminalSummary, executionProgress). Use this in both MessageBubble and ManagerConversation.

**Proposed component API:**

```typescript
interface ExecutionMetadataProps {
  usage?: UsageInfo;
  terminalSummary?: unknown;
  executionProgress?: ExecutionProgress;
  /** optional: compact mode for narrow panels */
  compact?: boolean;
}
```

**Extraction source:** Lines 188–309 of MessageBubble.tsx — the AI metadata section containing usage token breakdown, terminalSummary expand/collapse, and executionProgress status line.

**What it would NOT include:**
- DecisionCard (ChatInterface-specific)
- ActionBar (ChatInterface-specific)
- ResultDisplay/CodeBlock/PreviewPane (ChatInterface-specific)
- Avatar row (different styling per surface)
- Feedback buttons
- Delegation indicator
- LAYER_COLORS / routing layer badge

**Files touched:**

| File | Change |
|---|---|
| `frontend/src/components/chat/MessageBubble.tsx` | Replace lines 188–309 with `<ExecutionMetadata ...>` call; import the new component |
| `frontend/src/components/chat/ExecutionMetadata.tsx` | **NEW** — extracted component |
| `frontend/src/components/manager-workspace/ManagerConversation.tsx` | Add `ExecutionMetadata` below each manager message bubble |
| `frontend/src/types/dashboard.ts` | No change (types already exist) |

**Assessment:**

| Factor | Score | Detail |
|---|---|---|
| Code reuse | ✅ HIGH | Single source of truth for execution formatting |
| Scope control | ✅ SAFE | ~50-line component, no impact on existing rendering |
| Regression risk | ✅ NONE | MessageBubble just delegates to the new component — same output |
| Manager integration | ✅ EASY | Add `<ExecutionMetadata usage={...} terminalSummary={...} executionProgress={...} />` below manager messages |
| Backward compat | ✅ FULL | MessageBubble behavior unchanged |
| formatTerminalSummary | ✅ SHARED | Export from MessageBubble or co-locate in ExecutionMetadata | 

**Verdict: RECOMMENDED.** Minimal scope (~50 new lines, ~30 lines replaced in MessageBubble), zero regression risk, clean separation.

### Option C: Duplicate Minimal Rendering

**What it means:** Copy the usage/terminalSummary/executionProgress JSX inline to ManagerConversation.

**Assessment:**

| Factor | Score | Detail |
|---|---|---|
| Speed | ✅ FASTEST | Copy-paste, 0 new files |
| Maintenance | ❌ POOR | Two copies of the same rendering logic diverge over time |
| Consistency | ❌ RISK | Bug fix in one copy won't reach the other |
| Scope | ⚠️ MODERATE | ~60 lines duplicated in ManagerConversation |

**Verdict: NOT RECOMMENDED** unless Phase B timeline is extremely compressed. The maintenance cost of duplicated execution rendering is unjustified.

---

## 5. SessionDetail Execution Summary Options

### Critical Constraint: Data Availability

SessionDetail's backend APIs (`GET /v1/agent-sessions/:id`, `GET /v1/session-events`) do **not** return `usage`, `terminalSummary`, or `executionProgress`. These fields only exist in the SSE stream that ChatInterface consumes. The `agent_sessions` table has **no execution metadata columns**.

### Option A: Execution Status Summary Card (FROM EXISTING DATA)

**Data source:** AgentSession fields + SessionEvent[] (already fetched by SessionDetail).

**Content:**
- Session status (planning/running/completed/failed/cancelled)
- Worker status derived from events (worker_assigned/started/completed/failed)
- Error count from events (error_occurred count)
- Delegation outcome (delegation_accepted/rejected/failed)
- Risk level

**Assessment:**
- **Pros:** No backend changes, no new API calls, immediate implementation
- **Cons:** Not the same as usage/terminalSummary/executionProgress — this is session-level metadata, not Worker execution detail

### Option B: Worker Execution Data via New API (REQUIRES BACKEND)

**Data source:** New endpoint `GET /v1/agent-sessions/:id/execution` that joins session + task_archive + runtime_trace data.

**Content:** Full usage, terminalSummary, executionProgress, stage timings, worker summary.

**Assessment:**
- **Pros:** Complete execution visibility matching ChatInterface
- **Cons:** Requires backend changes (out of scope per Phase B non-goals). Would need to persist SSE execution data to agent_sessions or task_archive.

### Option C: Timeline Subset — Execution Events Only

**Data source:** Filter SessionEvent[] to execution-relevant types only.

**Filtered event types:**
```
worker_assigned, worker_started, worker_completed, worker_failed,
tool_execution_started, tool_execution_completed, tool_execution_failed,
plan_created, plan_executed, plan_failed,
decision_made, error_occurred, warning_raised
```

**Assessment:**
- **Pros:** No backend changes, leverages existing data
- **Cons:** Redundant with the full timeline already shown. Just a different grouping.

### Recommendation: Option A for Phase B (Status Summary Card)

Option A is the only viable path without backend changes. A compact summary card that distills session + event data into an execution overview is immediately achievable and adds genuine value. It should be documented as a **Phase B deliverable with the explicit caveat** that full execution metadata (usage, terminalSummary, progress) requires a future backend change.

---

## 6. Proposed Phase B Scope

### 6.1 Extract `ExecutionMetadata` Component (P0)

| Task | Description | Files | Est. lines |
|---|---|---|---|
| B1 | Create `ExecutionMetadata.tsx` | `frontend/src/components/chat/ExecutionMetadata.tsx` | +50 |
| B2 | Export `formatTerminalSummary` from `MessageBubble.tsx` (or co-locate) | `frontend/src/components/chat/MessageBubble.tsx` | ±5 |
| B3 | Wire `ExecutionMetadata` into `MessageBubble.tsx` | `frontend/src/components/chat/MessageBubble.tsx` | -30 / +5 |
| B4 | Wire `ExecutionMetadata` into `ManagerConversation.tsx` | `frontend/src/components/manager-workspace/ManagerConversation.tsx` | +15 |

**Prerequisite for B4:** ManagerConversation must receive `usage`/`terminalSummary`/`executionProgress` data. Currently it does not. Two sub-options:

| Sub-option | Approach | Backend change? |
|---|---|---|
| B4a | Extend `RouteMessageResponse` to include execution metadata from the routed Worker | ✅ Yes |
| B4b | Add a separate API call after routing to fetch session execution data | ✅ Yes |

**Decision: B4 is BLOCKED** on backend data availability. Recommend JIT/Fast-Follow after backend exposes execution metadata on the Manager routing API. For Phase B scope, B1–B3 (extract component, wire into MessageBubble) should proceed. B4 wiring is deferred to Phase B+Backend.

### 6.2 SessionDetail Execution Status Summary Card (P1)

| Task | Description | Files | Est. lines |
|---|---|---|---|
| B5 | Add execution status summary card to SessionDetail header area | `frontend/src/components/manager-workspace/SessionDetail.tsx` | +40 |

**Content:**
- Worker status (from events: worker_assigned → worker_started → worker_completed/failed)
- Error count (error_occurred events count)
- Plan status (plan_created → plan_executed)
- Execution artifacts count (sessions with decision_made events)

**Caveat:** This is session-level metadata from events, NOT Worker-level execution detail (usage/tokens/terminalSummary). Full execution data requires backend changes (separate spec).

### 6.3 Scope Not Included

| Item | Reason |
|---|---|
| Full execution metadata in SessionDetail | Requires backend: persist SSE data to agent_sessions table |
| ManagerConversation execution data display | Requires backend: extend /v1/manager/route-message response |
| MessageBubble refactoring (make generic) | Out of scope — no ChatInterface redesign |
| Routing layer visibility in Manager | Manager uses different routing model (routeType) |
| Time-travel / replay worker execution from SessionDetail | Requires runtime trace persistence (S101R Batch D territory) |

---

## 7. Non-Goals (unchanged from Phase A)

- No backend Worker/SSE changes
- No DB schema changes
- No full ChatInterface refactor
- No complex timeline unless explicitly approved
- No S101R Batch D cleanup
- No ManagerConversation role model change (`"manager"` stays `"manager"`)

---

## 8. Verification Plan

| Check | Command / Method |
|---|---|
| Frontend typecheck | `npx tsc --noEmit` in `frontend/` |
| Backend typecheck | `npx tsc --noEmit` in `trustos/` |
| S101I smoke regression | `node scripts/smoke/s101i-integration-smoke.mjs` (23 SSE + 22 Worker) |
| Manual: MessageBubble unchanged | Send a chat message in ChatInterface; verify usage/terminalSummary/executionProgress still render correctly |
| Manual: ExecutionMetadata standalone | Verify new component renders with all three props, with partial props, with no props |
| Manual: SessionDetail summary card | Open a completed session in Manager Workspace; verify summary card shows worker status / error count / plan status |

---

## 9. Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `formatTerminalSummary` export breaks tree-shaking | Low | None | Function is already stateless, safe to export |
| ManagerConversation wire-up reveals missing backend data | **Certain** | Medium | Document block explicitly; proceed with B1–B3 only |
| SessionDetail summary card looks redundant with timeline | Medium | Low | Card shows computed summary (counts, derived status); timeline shows raw events — complementary |
| ExecutionMetadata component grows beyond scope | Low | Medium | Strict prop interface; no new features without spec |

---

## 10. PM Decision Gates

| Gate | Question | Options |
|---|---|---|
| G1 | Proceed with B1–B3 (extract ExecutionMetadata, rewire MessageBubble)? | **Recommended: YES** |
| G2 | Proceed with B5 (SessionDetail summary card from events)? | **Recommended: YES** |
| G3 | B4 (ManagerConversation wire-up) — approve a separate backend spec for Manager execution metadata? | **Recommended: DEFER to separate fast-follow** |
| G4 | `formatTerminalSummary` — export from MessageBubble or co-locate in ExecutionMetadata? | **Recommended: co-locate in ExecutionMetadata.tsx, MessageBubble imports from there** |

---

## 11. Summary

```
S101P Phase B proposes two concrete, scoped deliverables:

1. ExecutionMetadata component (B1–B3)
   - Extract usage/terminalSummary/executionProgress rendering
   - ~50 lines new, ~25 lines deleted in MessageBubble
   - Zero regression risk, type-safe, ready for ManagerConversation when backend is ready

2. SessionDetail execution status summary card (B5)
   - From existing AgentSession + SessionEvent data
   - Worker status, error counts, plan status
   - ~40 lines new, no backend changes
   - Explicitly NOT full execution metadata (requires backend)

Combined scope: 3 files touched, ~90 lines net new, no backend changes, no schema changes.
```
