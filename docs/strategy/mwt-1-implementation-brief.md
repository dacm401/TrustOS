# MWT-1 Manager Shell Baseline — Implementation Brief

> **Status**: FINALIZED (2026-08-08)
> **Based on**: Archaeology report + TRST-4C API verification
> **Gate**: PM explicit MWT-1 start directive required before code changes

---

## 1. Objective

Make ChatInterface a visible Manager Shell by displaying Trust Layer observation status in the chat header. This is a **frontend-only** change — all backend APIs already exist.

## 2. Key Finding: Zero Backend Work Needed

Code archaeology confirmed:

```
Chat session_id = Gateway session_id (same UUID, same value)
```

ChatInterface generates `sessionId` via `useState(() => uuid())` on mount. This same UUID is passed as `X-TrustOS-Session-Id` to Gateway. TRST-4C `/events?session_id=xxx` can query events for this exact session.

All three required APIs are already implemented and have frontend hooks:

| API | Endpoint | Frontend Hook | Status |
|-----|----------|--------------|--------|
| Gateway health | `GET :8795/health` | `useGatewayHealth()` | ✅ Ready |
| Session events | `GET /events?session_id=X` | `useGatewayEvents({ session_id })` | ✅ Ready |
| Session list | `GET /sessions` | `useGatewaySessions()` | ✅ Ready |

## 3. Changes

### 3.1 ChatInterface.tsx — Header Enhancement

**File**: `frontend/src/components/chat/ChatInterface.tsx`

Three additions to the chat header:

1. **Session ID display**: Show truncated `sessionId` (already in state)
2. **Three-layer Gateway status**: Call `useGatewayHealth()` + `useGatewayEvents({ session_id })`

```
┌──────────────────────────────────────────┐
│ 💬 Chat                        sess_abc… │
│ 🔗 Gateway: Online                       │
│ 👁 Observation: Active / No events yet   │
│ 📊 Events captured: 3                    │
└──────────────────────────────────────────┘
```

**Implementation approach**:
```typescript
// Already exists in ChatInterface state
const [sessionId] = useState(() => uuid());

// NEW: call existing hooks
const { data: gwHealth } = useGatewayHealth({ refetchInterval: 10000 });
const { data: gwEvents } = useGatewayEvents({ session_id: sessionId });

// Derive display state
const gatewayOnline = gwHealth?.status === "ok";
const eventsCaptured = gwEvents?.total ?? 0;
const observationStatus = gatewayOnline
  ? (eventsCaptured > 0 ? "Active" : "No events yet")
  : "Not available";
```

**Key rule**: Observation status MUST be based on actual events query, not just `/health`. `gatewayOnline && eventsCaptured === 0` → "No events yet", NOT "Active".

### 3.2 ExecutionMetadata.tsx — Session Context

**File**: `frontend/src/components/chat/ExecutionMetadata.tsx` (shared component from S101P)

Add when available:
- `session_id`
- `trace_id`
- `events_captured` count

These are already in SSE `executionProgress` stream or derivable from Gateway query. Display only — no new data model.

### 3.3 Evidence Entrypoint

Add a `View Evidence` button/link in chat header carrying `session_id` context. Opens Evidence view with `?session_id=xxx` parameter. Does NOT claim full task-scoped evidence — just opens existing Evidence view with session context filter.

## 4. Files Touched

| File | Change | Risk |
|------|--------|------|
| `ChatInterface.tsx` | Header: session badge + Gateway status + Evidence link | LOW — add display, no logic change |
| `ExecutionMetadata.tsx` | Add session_id/trace_id/events_count fields | LOW — new display fields |
| `(Evidence page)` | Accept `?session_id` query param and pre-filter | LOW — existing filter support |

## 5. NOT Touched

- ❌ No new backend endpoints
- ❌ No new data model or schema
- ❌ No ManagerWorkspace restoration
- ❌ No navigation change (Chat stays Chat)
- ❌ No Worker lifecycle events
- ❌ No task_id / run_id introduction
- ❌ No SSE/F1 routing changes

## 6. Verification

### 6.1 Pre-change Baseline

- [ ] Run existing smoke tests to establish baseline (S101P suite)
- [ ] Verify `/events?session_id=X` returns correct events for current chat session
- [ ] Verify Gateway `/health` returns `status: "ok"`

### 6.2 Post-change Verification

- [ ] Chat header shows `session_id` (truncated)
- [ ] Gateway status shows "Online" when Gateway is running
- [ ] Gateway status shows "Offline" when Gateway is stopped
- [ ] Observation: "No events yet" when session has 0 events
- [ ] Observation: "Active" + "Events captured: N" when events exist
- [ ] Evidence link opens Evidence view with session context
- [ ] SSE streaming continues to work
- [ ] Fast/Slow routing still functional
- [ ] Existing smoke tests still pass
- [ ] Frontend typecheck: 0 errors (only for changed files)
- [ ] PM walkthrough: header clearly shows Trust observation status

## 7. Effort Estimate

**2-3 hours** (frontend-only display changes with existing APIs)

## 8. Risk

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gateway not running during dev | All status shows "Offline" | Acceptable — proves status works correctly |
| `/events?session_id=X` returns empty | "No events yet" shown | Correct behavior for new sessions |
| React hook re-render loop | UI flicker | Use `refetchInterval` instead of reactive polling |

---

*Brief finalized 2026-08-08. MWT-1 implementation starts on PM directive only.*
