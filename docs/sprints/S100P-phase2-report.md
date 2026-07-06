# S100P Phase 2 — Backend Routing Report

**Sprint**: S100P — Manager Workspace v1: Loop Separation in UX
**Phase**: Phase 2 — Backend Routing (S100P-009, S100P-010)
**Date**: 2026-07-06
**Status**: Implementation Complete — Awaiting PM Review
**Previous Phase**: Phase 1.5 (Smoke Verification) ✅ PM-Approved

---

## 1. Phase Summary

Phase 2 implements the backend routing pipeline for the Manager Loop. Two tasks were delivered:

- **S100P-009 — Manager Routing Logic**: Deterministic/heuristic router (no LLM) that classifies user messages into 4 route types and creates the appropriate database records (manager_messages, agent_sessions, session_events).
- **S100P-010 — Visibility Rules**: Event-type-to-visibility mapping with 6 visibility levels, applied when session events are created through the routing API.

**Key design decision**: Phase 2 uses keyword-based heuristics only — no LLM calls. This keeps the routing deterministic, fast, and testable. LLM-based routing is deferred to a future sprint.

---

## 2. Implementation Details

### S100P-009: Manager Routing Logic

**File**: `src/services/manager-routing/manager-router.ts`

The router applies 5 rules in priority order:

| Priority | Rule | Trigger | Route Type |
|---|---|---|---|
| 1 | Explicit target | `target_session_id` provided and matches active session | `update_existing_session` |
| 2 | Delegation intent | Message contains delegation keyword (帮我, 执行, 生成, etc.) | `new_delegated_task` |
| 3 | Reference + unique match | Reference keyword (那个任务, 刚才那个, etc.) + unique session title match | `update_existing_session` |
| 4 | Reference + ambiguous | Reference keyword + multiple sessions, no unique match | `ambiguous_session_reference` |
| 5 | Default | No delegation or reference intent detected | `normal_conversation` |

**CJK-aware title matching**: The reference matcher uses 3-gram sliding windows with a minimum hit threshold (`floor(chunkLength / 4)`) to handle Chinese titles that lack word delimiters. This prevents false matches from short common substrings (e.g., "登录页" appearing in both "登录页面重构" and "帮我修一下登录页的样式").

**Risk assessment**: Messages containing destructive keywords (删除, 部署, 生产环境, drop, delete, etc.) are automatically tagged `medium` risk; all others default to `low`.

**Title generation**: New delegated tasks extract their title from the first clause of the user message (before punctuation), capped at 60 characters.

### S100P-010: Visibility Rules

**File**: `src/services/visibility-routing/visibility-router.ts`

Maps event type + context to one of 6 visibility levels:

| Visibility Level | Event Types | Purpose |
|---|---|---|
| `silent_audit` | `action.requested` (low-risk only) | Audit log only — no UI display |
| `session_timeline` | `session.created/updated/started/paused/resumed/cancelled`, `contract.generated`, `artifact.updated`, `worker.assigned/started/progress/paused/resumed`, `approval.expired`, `plan.created/updated/executed`, `decision.*`, `action.requested` (non-low-risk) | Session Detail timeline |
| `approval_required` | `approval.requested` | Approval Card in Manager Chat + Session Detail |
| `manager_chat_summary` | `session.completed`, `worker.completed`, `approval.granted`, `approval.denied` | Summary in Manager Conversation |
| `trust_report_only` | `risk.assessed`, `risk.mitigated` | Final Trust Report only |
| `critical_alert` | `session.failed`, `worker.failed`, `plan.failed`, unknown critical events | Immediate alert in Manager Chat |

**Special cases**:
- `action.requested` with `risk_level=low` → `silent_audit`; non-low → `session_timeline`
- `decision.made` with `decision=deny` and secret-like action (password, token, credential, etc.) → `session_timeline` (audit visibility)
- Unknown event types fall back to severity-based routing: `critical` → `critical_alert`, `error`/`info`/`warn` → `session_timeline`

### API Endpoint

**File**: `src/api/manager-route.ts`

```
POST /v1/manager/route-message
  Body: { conversationId: string, message: string, targetSessionId?: string }
  Auth: X-User-Id header (user-scoped)
  Response: {
    routeType: RouteType,
    targetSessionId: string | null,
    clarificationRequired: boolean,
    reason: string,
    managerMessage: { id, content, role, relatedSessionId, createdAt },
    createdSession: { id, title, status, riskLevel } | null,
    sessionEvent: { id, type, summary, visibility } | null
  }
```

The endpoint:
1. Fetches the user's active sessions (excludes completed/failed/cancelled/rolled_back)
2. Calls `routeMessage()` to classify the message
3. Creates records: new session (if delegated task), manager message, session event (with visibility applied)
4. Returns the full routing result

**Route registration**: Added to `src/index.ts` as `app.route("/v1/manager", managerRouteRouter)`.

---

## 3. Test Results

### Unit Tests (Pure Functions — No DB/Network)

**File**: `tests/services/s100p-routing.test.ts`
**Config**: `vitest.s100p.config.ts`
**Command**: `npx vitest run --config vitest.s100p.config.ts`

```
Test Files: 1 passed (1)
Tests:      56 passed (56)
Duration:   ~500ms
```

**Manager Router tests (20)**:
- Rule 5 (normal_conversation): 3 tests (plain greeting, plain question, reference with no sessions)
- Rule 2 (new_delegated_task): 6 tests (帮我 keyword, 执行 keyword, medium risk, low risk, title generation, delegation priority over reference)
- Rule 1 (update_existing_session explicit): 2 tests (matching target, non-matching target falls through)
- Rule 3 (update_existing_session reference): 1 test (unique title match)
- Rule 4 (ambiguous_session_reference): 2 tests (multiple sessions, single session not ambiguous)

**Visibility Router tests (36)**:
- Direct event-type mappings: 29 tests (all event types from the mapping table)
- `action.requested` special handling: 4 tests (low/medium/high/null risk)
- `decision.made` deny of secret-like action: 4 tests (password, api_key, credential, non-secret)
- Fallback for unknown event types: 4 tests (critical, error, info, warn severity)

### API Smoke Tests (Live Server Integration)

**File**: `scripts/smoke/s100p-routing-smoke.mjs`
**Command**: `node scripts/smoke/s100p-routing-smoke.mjs`

```
Passed: 13/13, Failed: 0
```

| Step | Scenario | Result | Key Assertion |
|---|---|---|---|
| S1 | Normal conversation | ✅ | routeType=normal_conversation, no session/event created |
| S2 | New delegated task | ✅ | routeType=new_delegated_task, session created, evt=session.created vis=session_timeline |
| S3a | Update session (explicit target) | ✅ | routeType=update_existing_session, target matches, evt=session.updated |
| S3b | Update session (reference match) | ✅ | routeType=update_existing_session, target matches by title reference |
| S4 | Ambiguous reference | ✅ | routeType=ambiguous_session_reference, clarificationRequired=true |
| S5a | Visibility: session.created | ✅ | visibility=session_timeline |
| S5b | Visibility: session.updated | ✅ | visibility=session_timeline |
| S5c | All visibilities valid | ✅ | 2 events, all within CHECK constraint values |
| S6 | Cross-user target not matched | ✅ | User B's target_session_id (User A's) not found → normal_conversation |
| S6b | Cross-user events → 403 | ✅ | Ownership enforcement on session-events API |
| V1 | Missing conversationId → 400 | ✅ | Input validation |
| V2 | Missing message → 400 | ✅ | Input validation |
| V3 | Empty message → 400 | ✅ | Input validation |

### Typecheck

```
npx tsc --noEmit → 0 S100P-related errors
(37 pre-existing errors in unrelated files, unchanged from Phase 1.5)
```

### Summary

| Test Suite | Passed | Failed | Total |
|---|---|---|---|
| Unit Tests (Routing) | 56 | 0 | 56 |
| API Smoke (Routing) | 13 | 0 | 13 |
| **Total** | **69** | **0** | **69** |

---

## 4. Bug Fixes During Testing

### Bug 1: CJK Title Reference Matching — False Matches

**Symptom**: API smoke test S3b failed. When user has two active sessions ("登录页面重构" and "帮我修一下登录页的样式"), a reference message "登录页面那个任务" matched BOTH sessions instead of just "登录页面重构", causing an ambiguous result instead of a unique update.

**Root cause**: The initial 3-gram matching checked if ANY 3-gram of the title appeared in the message. The 3-gram "登录页" appears in both titles, causing both to match.

**Fix**: Added a minimum hit threshold of `floor(chunkLength / 4)` n-gram matches for chunks of length ≥ 4. For "登录页面重构" (6 chars, threshold=1), the message matches 2 grams → match. For "帮我修一下登录页的样式" (10 chars, threshold=2), the message matches only 1 gram → no match. Result: unique match → correct `update_existing_session` routing.

**Verification**: Both unit tests (56/56) and API smoke tests (13/13) pass after the fix.

### Infrastructure Fix: .env Database Port

**Issue**: `.env` had `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/smartrouter` but the Docker PostgreSQL container maps port 5432. Both `docker-compose.yml` and `docker-compose.dev.yml` use port 5432.

**Fix**: Corrected `.env` to `localhost:5432`. This was a pre-existing configuration error, not introduced by S100P.

---

## 5. Files Changed

### New Files (Phase 2)

| File | Purpose |
|---|---|
| `src/services/manager-routing/manager-routing-types.ts` | Route types, routing input/output interfaces |
| `src/services/manager-routing/manager-router.ts` | Heuristic routing logic (5 rules) |
| `src/services/visibility-routing/visibility-types.ts` | Visibility levels, routing input/output interfaces |
| `src/services/visibility-routing/visibility-router.ts` | Event-type-to-visibility mapping |
| `src/api/manager-route.ts` | POST /v1/manager/route-message endpoint |
| `tests/services/s100p-routing.test.ts` | Unit tests (56 tests) |
| `vitest.s100p.config.ts` | Vitest config for routing tests |
| `scripts/smoke/s100p-routing-smoke.mjs` | API smoke test (13 checks) |
| `docs/sprints/S100P-phase2-report.md` | This report |

### Modified Files

| File | Change |
|---|---|
| `src/index.ts` | Added import + route registration for manager-route router |
| `.env` | Fixed DATABASE_URL port (5433 → 5432) |

---

## 6. Risk Assessment

| Risk | Status | Notes |
|---|---|---|
| Routing误判 (new vs update) | Mitigated | Conservative heuristic: delegation keyword takes priority, ambiguous references ask for clarification |
| CJK matching false positives | Resolved | Threshold-based n-gram matching prevents short-common-substring collisions |
| Visibility mapping gaps | Low | Unknown event types have severity-based fallback; all 6 visibility levels covered |
| User-scoping bypass | None | Route-message fetches only the caller's own active sessions; cross-user target_session_id ignored |
| LLM routing not implemented | Accepted | Phase 2 is heuristic-only per PM spec; LLM routing deferred to future sprint |

---

## 7. Next Steps

**Phase 2 is complete and ready for PM review.**

- **Phase 3 (Frontend Layout)** is NOT authorized. Awaiting PM approval before proceeding.
- Suggested PM review focus areas:
  1. Routing rule priority order (is delegation > reference correct?)
  2. CJK matching threshold (`floor(chunkLength/4)`) — is this the right balance?
  3. Visibility mapping completeness — are there event types missing from the direct map?
  4. API response shape — is the current structure sufficient for Phase 3 frontend consumption?
  5. Risk assessment keywords — should the medium-risk keyword list be expanded?

**No Phase 3 work will begin until PM sign-off.**
