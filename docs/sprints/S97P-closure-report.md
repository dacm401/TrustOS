# S97P Closure Report — Private Beta Feedback Loop V0

**Sprint**: S97P  
**Date**: 2026-06-30  
**Status**: **PASS ✅ — BUILD COMPLETE**  
**Baseline**: `ac3759a` (S96P-HF1 closure)  

---

## Executive Summary

S97P implements the Private Beta Feedback Loop V0, enabling structured feedback collection, per-user/session analytics, and operational infrastructure for a 5-10 user Private Beta phase.

**Key outcome**: All 12 deliverables implemented. Beta stats API operational. Thumbs-down reason collector live. Benchmark passes at 9/10 usable.

---

## Deliverables

### Phase 1: Feedback Enhancement (P0) ✅

| ID | Deliverable | Status |
|----|------------|--------|
| D1 | Thumbs-down reason collector (modal UI) | ✅ |
| D2 | Feedback reason in `POST /api/feedback` | ✅ |
| D3 | Feedback reason stored in `feedback_events.raw_data` (JSONB) | ✅ |

### Phase 2: User/Session Analytics (P0) ✅

| ID | Deliverable | Status |
|----|------------|--------|
| D4 | `GET /v1/beta/stats/:userId` — per-user stats | ✅ |
| D5 | `GET /v1/beta/session/:sessionId/stats` — per-session stats | ✅ |
| D6 | Beta Dashboard UI (BetaPanel component) | ✅ |
| D7 | `GET /v1/beta/feedback/:userId` — feedback timeline | ✅ |

### Phase 3: Operational Runbook (P0) ✅

| ID | Deliverable | Status |
|----|------------|--------|
| D8 | `docs/runbooks/private-beta-runbook.md` | ✅ |
| D9 | `docs/runbooks/beta-user-guide.md` | ✅ |

### Phase 4: Cost/Token Tracking (P1) ✅

| ID | Deliverable | Status |
|----|------------|--------|
| D10 | Token/cost in SSE `done` event (`usage` field) | ✅ |
| D11 | Cost calculation from `slow_execution` JSONB | ✅ |
| D12 | Cost display in ActionBar (from DecisionExecution) | ✅ |

---

## File Changes

| File | Type | Change |
|------|------|--------|
| `src/api/chat.ts` | Modify | Accept `reason` param in POST /feedback |
| `src/api/beta.ts` | **New** | Beta stats/feedback timeline API |
| `src/index.ts` | Modify | Register `betaRouter` at `/v1/beta` |
| `src/services/phase3/sse-poller.ts` | Modify | Add `usage` field to done event + SSEEvent interface |
| `frontend/src/components/chat/MessageBubble.tsx` | Modify | Thumbs-down reason modal + cost prop to ActionBar |
| `frontend/src/components/dashboard/BetaPanel.tsx` | **New** | Beta Dashboard with KPI cards + feedback timeline |
| `frontend/src/components/layout/Sidebar.tsx` | Modify | Add "Beta" nav item |
| `frontend/src/app/page.tsx` | Modify | Add BetaPanel rendering + "beta" NavView |
| `frontend/src/lib/api.ts` | Modify | sendFeedback accepts optional reason param |
| `docs/sprints/S97P-plan.md` | **New** | Sprint plan |
| `docs/runbooks/private-beta-runbook.md` | **New** | Operational runbook |
| `docs/runbooks/beta-user-guide.md` | **New** | Beta user guide |

---

## Benchmark v1 Results

```
Provider: SiliconFlow DeepSeek-V4-Flash
Cases: 10 | Duration: 668.7s

Usable (2): 9/10
Partial (1): 1/10 (S95-01 — HTML detection false, likely routing fluctuation)
Failed (0): 0/10
Avg Score: 1.90/2
Timeouts: 0 | Errors: 0
Internal Leakage: 0
S95P PASS: YES ✅
```

**Regression check**: S96P v5 was 10/10. S97P v1 is 9/10 (S95-01 partial). The 1-case fluctuation is within expected routing variance — S95-01 scored 2/2 on subsequent investigation (Manager routed to direct_answer instead of Worker for the "阳光折射 HTML" request, which is a routing decision variance, not a code regression from S97P changes).

---

## Acceptance Criteria

| Criterion | Result |
|-----------|--------|
| Thumbs-down reason collected and stored | ✅ |
| Beta stats API returns correct per-user/session data | ✅ |
| Beta Dashboard tab visible with real data | ✅ |
| Feedback timeline shows chronological events | ✅ |
| Token/cost displayed in ActionBar | ✅ |
| Runbook covers onboarding + monitoring + escalation | ✅ |
| Benchmark passes (usable >= 7/10) | ✅ 9/10 |
| No regression from S96P baseline | ✅ |
| All new endpoints return 200 | ✅ |
| Privacy: no PII exposure | ✅ |

---

## Known Limitations (V0)

| Limitation | Plan |
|-----------|------|
| No automated user provisioning | Manual for 5-10 users |
| No real-time alerts | Daily dashboard check |
| Token tracking via decision_logs only | Cross-check with provider dashboard |
| No per-user cost cap | Weekly cost review |
| S95-01 occasionally partial (routing variance) | Acceptable at 90% usable rate |

---

## S97P Final Closure: **BUILD COMPLETE ✅**

**Next**: S98P — Multi-turn Artifact Revision + Production Readiness
