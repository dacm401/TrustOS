# S100P Phase 2 Report — Backend Routing (S100P-009 / S100P-010)

Sprint: S100P — Manager Workspace v1: Loop Separation in UX
Phase: 2 (Backend Routing)
Date: 2026-07-06
Status: Phase 2 COMPLETE — Awaiting PM Review (NO Phase 3)

---

## 1. Phase Scope

Phase 2 implements **backend routing only**. No UI, no frontend changes, no Phase 3 work.

| Task | Title | Status |
|---|---|---|
| S100P-009 | Manager Routing Logic | ✅ Complete |
| S100P-010 | Visibility Rules | ✅ Complete |

**Explicitly excluded** (per PM directive):
- No three-column layout / UI
- No Worker Timeline UI
- No Approval Card UI
- No Agent Engine / Sandbox / MCP scope

---

## 2. Deliverables

### 2.1 Manager Router (`S100P-009`)

**Files:**
- `src/services/manager-routing/manager-routing-types.ts` — Type definitions: `RouteType`, `ManagerRoutingInput`, `ManagerRoutingResult`, `ActiveSessionSummary`, `SessionEventSuggestion`, `NewSessionSuggestion`
- `src/services/manager-routing/manager-router.ts` — Core `routeMessage()` function with deterministic heuristic routing

**Routing Rules (priority order):**

| Priority | Rule | Condition | Result |
|---|---|---|---|
| 1 | Explicit target | `target_session_id` provided and found in user's active sessions | `update_existing_session` |
| 2 | Delegation intent | Message contains delegation keyword (帮我, 执行, 生成, 修, etc.) | `new_delegated_task` (creates session) |
| 3 | Reference + unique match | Reference keyword (那个任务, 刚才那个, etc.) + unique session title match | `update_existing_session` |
| 4 | Reference + ambiguous | Reference keyword + multiple/no unique session match | `ambiguous_session_reference` (asks clarification) |
| 5 | Normal conversation | No delegation or reference keywords | `normal_conversation` |

**Chinese Title Matching (N-gram):**

The `matchSessionByReference()` function uses a 3-gram sliding window for CJK titles:
- Splits title by delimiters into chunks
- For chunks ≥ 4 chars: generates 3-grams, counts hits in message, requires `hitCount >= floor(chunkLength / 4)` to match
- For chunks 2-3 chars: direct substring check
- Threshold prevents false matches from short common substrings (e.g., "登录页" matching both "登录页面重构" and "帮我修一下登录页的样式")

**Risk Assessment:**
- `assessRisk()` checks for medium-risk keywords: 删除, 修改数据库, 生产环境, 部署, 上线, drop, delete, migrate
- Default: low; matches → medium

**Title Generation:**
- `generateTitle()` extracts first clause (before punctuation), max 60 chars
- Fallback: first 40 chars of message

### 2.2 Visibility Router (`S100P-010`)

**Files:**
- `src/services/visibility-routing/visibility-types.ts` — `VisibilityLevel` type, `VisibilityRoutingInput`, `VisibilityRoutingResult`
- `src/services/visibility-routing/visibility-router.ts` — Core `routeVisibility()` function

**Visibility Levels (6-tier):**

| Level | Description | Display Target |
|---|---|---|
| `silent_audit` | Audit log only | Hidden from user |
| `session_timeline` | Session Detail timeline | Session Detail panel |
| `approval_required` | Approval Card | Manager Chat + Session Detail |
| `manager_chat_summary` | Manager Conversation summary | Manager Chat |
| `trust_report_only` | Final Trust Report | Trust Report panel |
| `critical_alert` | Immediate alert | Manager Chat (urgent) |

**Event Type → Visibility Mapping (30+ event types):**

| Event Type | Visibility |
|---|---|
| session.created / updated / started / paused / resumed / cancelled | session_timeline |
| session.completed | manager_chat_summary |
| session.failed | critical_alert |
| contract.generated | session_timeline |
| artifact.updated | session_timeline |
| worker.assigned / started / progress / paused / resumed | session_timeline |
| worker.completed | manager_chat_summary |
| worker.failed | critical_alert |
| approval.requested | approval_required |
| approval.granted / denied | manager_chat_summary |
| approval.expired | session_timeline |
| plan.created / updated / executed | session_timeline |
| plan.failed | critical_alert |
| decision.made / reviewed / reversed | session_timeline |
| risk.assessed / mitigated | trust_report_only |

**Special Handling:**
- `action.requested` with `risk_level=low` → `silent_audit`; non-low → `session_timeline`
- `decision.made` with `decision=deny` and secret-like action (secret/password/token/api_key/credential/私钥/密码/令牌) → `session_timeline` (audit trail)
- Fallback: critical severity → `critical_alert`; error → `session_timeline`; info/warn/debug → `session_timeline`

### 2.3 API Endpoint

**File:** `src/api/manager-route.ts`

**Endpoint:** `POST /v1/manager/route-message`

**Request:**
```json
{
  "conversationId": "string (required)",
  "message": "string (required, non-empty)",
  "targetSessionId": "string (optional)"
}
```

**Response (200):**
```json
{
  "routeType": "normal_conversation | new_delegated_task | update_existing_session | ambiguous_session_reference",
  "targetSessionId": "string | null",
  "clarificationRequired": "boolean",
  "reason": "string",
  "managerMessage": { "id", "content", "role", "relatedSessionId", "createdAt" },
  "createdSession": { "id", "title", "status", "riskLevel" } | null,
  "sessionEvent": { "id", "type", "summary", "visibility" } | null
}
```

**Input Validation:**
- Missing/empty `conversationId` → 400
- Missing/empty `message` → 400
- Invalid JSON → 400

**Ownership:** All session queries are scoped by `user_id` from `getContextUserId()`. Cross-user `targetSessionId` is not found in user's active sessions → falls through to normal conversation (no cross-user session access).

### 2.4 Route Registration

**File:** `src/index.ts` (modified)

```typescript
import { managerRouteRouter } from "./api/manager-route.js";
// ...
app.route("/v1/manager", managerRouteRouter);
```

### 2.5 Test Assets

- `tests/services/s100p-routing.test.ts` — 56 unit tests
- `vitest.s100p.config.ts` — Vitest config for S100P tests
- `scripts/smoke/s100p-routing-smoke.mjs` — Phase 2 API smoke test (13 checks)

---

## 3. Test Results

### 3.1 Unit Tests

```
Test Files  1 passed (1)
     Tests  56 passed (56)
  Duration  423ms
```

**Coverage:**
- S1-S5: Route type determination (normal, delegation, explicit target, reference match, ambiguous)
- S6-S10: Edge cases (no active sessions, empty message, target not found, delegation + reference overlap, risk assessment)
- V1-V6: Full visibility matrix (all 6 levels × representative event types)
- V7-V10: Visibility special cases (action.requested risk-based, decision.made secret-deny, unknown event fallback, severity-based fallback)
- S11-S14: Title generation and n-gram matching edge cases
- S15: Chinese n-gram collision prevention (threshold verification)

### 3.2 API Smoke Test (Live Server)

```
=== S100P Phase 2 Routing Smoke ===
Passed: 13/13, Failed: 0
```

| Check | Scenario | Result |
|---|---|---|
| S1 | Normal conversation (no keywords) | ✅ |
| S2 | New delegated task (delegation keyword) | ✅ session.created, vis=session_timeline |
| S3a | Update existing session (explicit targetSessionId) | ✅ session.updated, vis=session_timeline |
| S3b | Update via reference match (Chinese n-gram) | ✅ target matched correctly |
| S4 | Ambiguous session reference (multiple sessions) | ✅ clarificationRequired=true |
| S5a | session.created → session_timeline | ✅ |
| S5b | session.updated → session_timeline | ✅ |
| S5c | All event visibilities valid | ✅ |
| S6 | Cross-user target_session_id not matched | ✅ normal_conversation |
| S6b | Cross-user session-events → 403 | ✅ |
| V1 | Missing conversationId → 400 | ✅ |
| V2 | Missing message → 400 | ✅ |
| V3 | Empty message → 400 | ✅ |

### 3.3 TypeScript Check

```
S100P-related errors: 0
Pre-existing errors: 36 (in chat.ts, llm-native-router.ts, sse-poller.ts, etc.)
```

No new TypeScript errors introduced by Phase 2.

---

## 4. Issues Found and Resolved

### 4.1 Chinese N-gram Matching Collision (Fixed)

**Problem:** Initial n-gram matching used a loose threshold, causing "登录页" (3-gram) to match multiple sessions that happened to contain the same substring.

**Fix:** Implemented adaptive threshold: `hitCount >= max(1, floor(chunkLength / 4))`. For a 6-char title like "登录页面重构", threshold=1 (2 hits > 1 → match). For an 11-char title like "帮我修一下登录页的样式", threshold=2 (1 hit < 2 → no match). This correctly disambiguates sessions with partial substring overlap.

**Verified:** Unit test S15 and API smoke S3b both confirm correct behavior.

### 4.2 Stale Server Process (Resolved)

**Problem:** API smoke test initially failed (12/13) because an old server process (PID 35304) was bound to port 3001, running pre-n-gram-fix code. The newly started server couldn't bind to the port.

**Fix:** Killed stale process, restarted server with current code. All 13/13 checks pass.

---

## 5. Risk Register Update

| Risk | Status | Notes |
|---|---|---|
| BOM in migration SQL | Open (follow-up) | Node.js `pg` library fails on UTF-8 BOM. Workaround: `psql -f`. Migration runner should strip BOM. Does not affect Phase 2. |
| Manager routing misclassification | Mitigated | Conservative strategy: ambiguous → ask clarification, never guess. N-gram threshold prevents false matches. |
| Visibility mapping gaps | Mitigated | Fallback rules handle unknown event types by severity. All 30+ known event types have explicit mappings. |

---

## 6. Files Changed (Phase 2)

### New Files (6)
- `src/services/manager-routing/manager-routing-types.ts`
- `src/services/manager-routing/manager-router.ts`
- `src/services/visibility-routing/visibility-types.ts`
- `src/services/visibility-routing/visibility-router.ts`
- `src/api/manager-route.ts`
- `tests/services/s100p-routing.test.ts`
- `vitest.s100p.config.ts`
- `scripts/smoke/s100p-routing-smoke.mjs`

### Modified Files (1)
- `src/index.ts` — Added `managerRouteRouter` import and route registration

### Documentation (1)
- `docs/sprints/S100P-phase2-report.md` — This report

---

## 7. Phase 2 Acceptance Criteria

| Criterion | Status | Evidence |
|---|---|---|
| S100P-009: 4 route types implemented | ✅ | normal_conversation, new_delegated_task, update_existing_session, ambiguous_session_reference |
| S100P-009: Delegation keyword detection | ✅ | 15 keywords, generates title + risk assessment |
| S100P-009: Session reference matching | ✅ | N-gram (3-char) with adaptive threshold for CJK |
| S100P-009: Ambiguous reference → clarification | ✅ | Lists all active sessions, asks user to choose |
| S100P-009: API endpoint POST /v1/manager/route-message | ✅ | Input validation, ownership scoping, event creation |
| S100P-010: 6 visibility levels | ✅ | silent_audit, session_timeline, approval_required, manager_chat_summary, trust_report_only, critical_alert |
| S100P-010: Event type → visibility mapping | ✅ | 30+ event types mapped, special handling for action.requested and decision.made |
| S100P-010: Fallback for unknown events | ✅ | Severity-based: critical→critical_alert, error→session_timeline, default→session_timeline |
| Unit tests pass | ✅ | 56/56 |
| API smoke test pass | ✅ | 13/13 |
| TypeScript: 0 new errors | ✅ | 36 pre-existing, 0 S100P |
| No Phase 3 scope | ✅ | No UI, no frontend changes |

---

## 8. Next Steps

**Phase 2 is complete.** Awaiting PM Review before proceeding.

**Phase 3 (NOT started — requires PM approval):**
- S100P-001: Manager Workspace Layout (three-column)
- S100P-005: Delegation Contract Summary Panel

**Known follow-ups (not blocking):**
- BOM stripping in migration runner
- Integration with actual Worker event producers (Phase 3+)
- Visibility filtering in session-events API query (currently returns all; UI will filter)
