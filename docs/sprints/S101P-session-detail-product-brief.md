# S101P Session Detail Product Brief

## 1. Background

S101I completed Worker execution integration:
- `command → worker → archive → SSE → frontend` path verified end-to-end
- Frontend now consumes `progress` / `partial_result` / `usage` / `terminalSummary` events
- Two smoke scripts (45 PASS / 0 FAIL) provide repeatable contract verification

**S101P focuses on productizing this visibility** — turning raw signals into a coherent user experience in the Session Detail and Manager Workspace views. S101I wired the lights; S101P designs the dashboard.

---

## 2. Current UX Audit

### 2.1 MessageBubble (ChatInterface view)

| Element | Current Behavior | Gap | User Impact |
|---|---|---|---|
| **terminalSummary** | Single-line truncation (max 300px), native `title` hover tooltip, 📋 emoji prefix, light purple background | No expand/collapse; objects serialized as JSON then truncated to 200 chars — displays raw JSON fragments | User sees `{"key":"val...` instead of readable summary |
| **usage** | Model name + total tokens + USD cost, only shown when `!decision?.execution` | Hidden entirely when a decision.execution is present; no tooltip for breakdown (input vs output tokens) | User can't see usage when both decision and worker execution occurred |
| **progress** | Transient: sets `thinkingState="executing"` + `statusMsg`, not persisted to messages | Invisible after stream ends — no record that execution happened or what step was in progress | User sees "Executing" briefly then it disappears |
| **partial_result** | Transient: sets `statusMsg` only, does not update thinkingState | Even more invisible than progress — only a status message that vanishes on next event | User never sees intermediate results unless they catch the transient message |
| **thinking indicator** | Shows emoji + label + animated dots (idle/thinking/analyzing/routing/planning/executing/responding/completed/error) | No step counter or progress fraction (e.g., "Step 3/5") | User knows "something is happening" but not how far along |

### 2.2 ManagerWorkspace → ManagerConversation

| Element | Current Behavior | Gap | User Impact |
|---|---|---|---|
| **Message rendering** | Inline-styled divs, does NOT reuse MessageBubble component | No decision/usage/terminalSummary display at all in manager conversation | Manager view is a second-class citizen for execution visibility |
| **Loading state** | Three bouncing dots (● ● ●) | No thinking state mirroring ChatInterface's ThinkingIndicator | Manager can't distinguish "thinking" vs "executing" vs "responding" |

### 2.3 SessionDetail Panel

| Element | Current Behavior | Gap | User Impact |
|---|---|---|---|
| **Event timeline** | Lists 48 SessionEvent types with icons + timestamps | Completely disconnected from SSE stream events (progress/partial_result/usage/terminalSummary) | Session events and execution signals are two separate silos |
| **Session status** | Shows planning/delegated/running/waiting_approval/paused/completed/failed/cancelled/rolled_back | No link to worker execution state or terminal summary | Status badge is a coarse label, not actionable insight |

### 2.4 Data Flow Gaps

```
SSE Stream Events          Message State           Session Events
─────────────────    ────────────────    ──────────────────
progress       ──→   transient statusMsg    (not visible)
partial_result ──→   transient statusMsg    (not visible)
usage          ──→   msg.usage             (only if !decision.execution)
terminalSummary──→   msg.terminalSummary    (truncated, raw JSON)
done           ──→   thinkingState=completed  (not in session events)
```

**Three disconnects**:
1. `progress`/`partial_result` are ephemeral — lost after stream ends
2. `SessionDetail` events and `SSE stream` events are separate data sources with no bridge
3. `ManagerConversation` has zero SSE event consumption

---

## 3. User Stories

### P0 — Must Have

1. **As a user watching a Worker execute**, I can see what step it's on and whether it's making progress — not just "Executing" then silence.
2. **As a user reviewing a completed task**, I can read a human-readable terminal summary without seeing raw JSON fragments.
3. **As a user inspecting costs**, I can see token usage and estimated cost for worker-executed tasks, even when a decision structure is also present.

### P1 — Should Have

4. **As a Manager**, I can see the same execution signals (progress, usage, summary) in the Manager Conversation view that a direct user sees in ChatInterface.
5. **As a user returning to a session**, I can see a record of the execution progress that happened while I was away — not just the final result.

### P2 — Nice to Have

6. **As a user browsing the Session Detail panel**, I can see execution events (progress/result/summary) alongside the existing session event timeline.
7. **As a user with a long terminal summary**, I can expand/collapse it inline rather than squinting at a tooltip.

---

## 4. Proposed Scope

### Phase A Candidates — Minimal Productization

| # | Feature | Description | Complexity | Priority |
|---|---------|-------------|------------|----------|
| A1 | **terminalSummary readability** | Humanize object-type summaries: extract `summary` or `message` field, fall back to smart truncation; add expand/collapse instead of only tooltip | Low | P0 |
| A2 | **usage always-visible** | Remove `!decision?.execution` gate; show usage unconditionally when present; add input/output token breakdown tooltip | Low | P0 |
| A3 | **progress persistence** | Write progress/partial_result events into message state as non-streaming metadata entries (not full messages, but visible markers) | Medium | P0 |
| A4 | **ManagerConversation parity** | Reuse MessageBubble in ManagerConversation, or extract shared rendering to ensure usage/terminalSummary/decision appear in manager view | Medium | P1 |
| A5 | **SessionDetail execution bridge** | Add a lightweight execution summary section to SessionDetail showing terminalSummary + usage when available (pull from latest archive, not real-time SSE) | Low | P1 |

### Phase B Candidates — Experience Deepening

| # | Feature | Description | Complexity | Priority |
|---|---------|-------------|------------|----------|
| B1 | **Progress timeline** | Show step-by-step progress as a mini-timeline in the message bubble (progress events with step labels) | Medium | P2 |
| B2 | **SessionDetail SSE event mirror** | Bridge SSE stream events into SessionDetail's event timeline as lightweight entries | Medium | P2 |
| B3 | **Usage summary card** | Collapsible card in SessionDetail showing cumulative usage across all messages in a session | Medium | P2 |
| B4 | **Terminal summary expand/collapse** | Replace native `title` tooltip with inline expand/collapse for summaries > 100 chars | Low | P2 |

### Proposed Phase A MVP Scope

```text
A1 + A2 + A3 = P0 baseline (terminalSummary readability + usage always-visible + progress persistence)
A4 + A5 = P1 manager/session parity
```

**Estimated impact**: 4-5 files changed, ~100-200 lines

---

## 5. Non-Goals

Explicitly out of scope for S101P:

- **Worker backend logic** — execution, scheduling, archive writes unchanged
- **SSE protocol** — event types, payload structure unchanged
- **Database schema** — no new tables, columns, or migrations unless separately approved
- **ChatInterface architecture** — no major refactor; changes are additive metadata rendering
- **S101R Batch D cleanup** — remains HOLD; not resumed inside S101P
- **Real-time WebSocket migration** — SSE remains the transport
- **Pricing/billing logic** — usage display only; no billing calculation changes
- **New UI framework/components** — no new component libraries; use existing patterns

---

## 6. Implementation Candidates

### Likely files touched (Phase A):

| File | Change | Scope |
|---|---|---|
| `frontend/src/components/chat/MessageBubble.tsx` | A1: terminalSummary humanization + expand; A2: usage always-visible; A3: progress markers | P0 |
| `frontend/src/components/chat/ChatInterface.tsx` | A3: progress/partial_result → message state persistence | P0 |
| `frontend/src/components/manager-workspace/ManagerConversation.tsx` | A4: reuse MessageBubble or shared rendering for execution metadata | P1 |
| `frontend/src/components/manager-workspace/SessionDetail.tsx` | A5: execution summary section (terminalSummary + usage) | P1 |
| `frontend/src/types/dashboard.ts` | Possible type extensions for progress message entries | P0 |

### Files NOT expected to change:

```text
backend/ — all backend unchanged
src/services/phase3/ — SSE emitter unchanged
src/db/ — no schema changes
scripts/ — smoke scripts remain valid; may add S101P-specific smoke later
```

---

## 7. Verification Plan

| Check | Method |
|---|---|
| Backend `npx tsc --noEmit` | Must remain PASS (0 errors) |
| Frontend `npx tsc --noEmit` | Must remain PASS (0 errors) |
| S101I smoke scripts | Both must remain 45/45 PASS |
| Visual smoke | Manual: send execute_plan, verify summary renders readably, usage visible, progress markers appear |

---

## 8. Technical Risk Assessment

| Risk | Likelihood | Mitigation |
|---|---|---|
| terminalSummary format varies by provider/model | Medium | Defensive parsing: try `summary`/`message` field extraction, fall back to JSON stringify |
| Progress persistence may clutter message list | Low | Use compact inline badges, not full message entries |
| ManagerConversation refactor touches shared chat state | Medium | Phase A4 is deferred to P1, allowing P0 to ship independently |
| SessionDetail execution summary depends on archive read path | Low | Already verified by S101I smoke; read-only query |

---

## 9. Dependencies

- **S101I smoke scripts**: Provide baseline verification; must remain passing
- **SSE event types**: `StreamEvent` interface (frontend) and `SSEEvent` type (backend) are the contract
- **Worker archive writes**: `slow_execution` column in `task_archives` is the data source for SessionDetail execution summary

---

## 10. Open Decisions for PM

| # | Question | Options | Recommendation |
|---|----------|---------|----------------|
| D1 | Should usage/cost be always visible or behind a hover/details toggle? | a) Always visible inline b) Collapsed by default, expandable c) Tooltip-only | **Recommend (a)** for P0 — inline, compact, non-intrusive |
| D2 | Should progress markers persist as inline badges in the message bubble or as a separate timeline? | a) Inline badges b) Expandable timeline c) SessionDetail only | **Recommend (a)** for Phase A — minimal, additive, no new layout |
| D3 | Should partial_result be persisted visibly or remain transient? | a) Persist as collapsible section b) Keep transient, improve statusMsg only c) Show in SessionDetail only | **Recommend (a)** — persist as compact collapsible "Intermediate Result" section |
| D4 | Should terminalSummary appear in message bubble, SessionDetail, or both? | a) MessageBubble only (current) b) Both c) SessionDetail only | **Recommend (b)** — MessageBubble for quick glance, SessionDetail for full review |
| D5 | ManagerConversation parity (A4): full MessageBubble reuse or lightweight metadata extraction? | a) Full reuse b) Extract metadata rendering to shared component c) Accept gap, defer to later sprint | **Recommend (b)** — extract shared `ExecutionMetadata` component |

---

## 11. Phase A Implementation Order

Recommended execution order (dependency-aware):

```text
1. A1: terminalSummary humanization         (standalone, no deps)
2. A2: usage always-visible                 (standalone, no deps)
3. A3: progress persistence                 (requires ChatInterface state change)
4. A5: SessionDetail execution summary      (depends on A1 for readable summary)
5. A4: ManagerConversation parity           (depends on A1+A2 patterns being stable)
```

A1+A2 can ship together as a single commit. A3 is the medium-complexity item.

---

## 12. S101P Status

```text
S101P Brief: READY FOR PM REVIEW
S101P Phase A: NOT YET APPROVED
S101P Phase B: NOT YET PLANNED
```

---

## 13. Current Project State

```text
S100P: CLOSED / ACCEPTED
S101T: CLOSED / ACCEPTED
S101R Batch A: ACCEPTED
S101R Batch B: ACCEPTED
S101R Batch C: ACCEPTED
S101R Batch D: HOLD
S101I: CLOSED / ACCEPTED
S101P Brief: DRAFT — PENDING PM REVIEW
S101P Implementation: NOT STARTED
```
