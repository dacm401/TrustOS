# S97P — Private Beta Feedback Loop V0

**Sprint**: S97P  
**Date**: 2026-06-30  
**Baseline**: `ac3759a` (S96P-HF1 closure)  
**Goal**: Build the feedback collection, analysis, and operational infrastructure for a 5-10 user Private Beta phase.  

---

## PM Goal

Enable 5-10 beta users to provide structured feedback on every AI response, and give the product team visibility into user satisfaction, task quality, and cost per session — without building a full analytics pipeline.

**Key principle**: Feedback is lightweight (thumbs up/down + optional reason), non-blocking, and privacy-safe.

---

## Existing Infrastructure (S96P Baseline)

| Capability | Status | Notes |
|-----------|--------|-------|
| `POST /api/feedback` | ✅ S84P | thumbs_up/down, accepted, regenerated, etc. |
| `FeedbackEventRepo` | ✅ S84P | Stores feedback_events with userId/decisionId |
| `feedback-collector.ts` | ✅ S84P | Score mapping + auto-learn |
| Thumbs UI in MessageBubble | ✅ S84P | 👍/👎 buttons with visual feedback |
| DashboardView | ✅ S94P | StatsCards, charts, delegation logs |
| Session API | ✅ S94P | `/v1/sessions/recent`, session summaries |
| User ID via X-User-Id | ✅ S84P | Identity middleware |
| Task observability | ✅ S94P | Task traces, results, retry |

---

## S97P Deliverables

### Phase 1: Feedback Enhancement (P0)

| ID | Deliverable | Description |
|----|------------|-------------|
| **D1** | Thumbs-down reason collector | When user clicks 👎, show a lightweight modal/text input to collect optional reason (text, max 200 chars) |
| **D2** | Feedback reason in API | Extend `POST /api/feedback` to accept `reason?: string` field. Store in `feedback_events.raw_data` |
| **D3** | Feedback reason in DB | Add migration for `feedback_reason TEXT` column on `feedback_events` |

### Phase 2: User/Session Analytics (P0)

| ID | Deliverable | Description |
|----|------------|-------------|
| **D4** | `GET /api/beta/stats/:userId` | Per-user beta stats: total sessions, total feedback events, thumbs_up/down ratio, avg task duration, total tokens, total cost |
| **D5** | `GET /api/beta/session/:sessionId/stats` | Per-session stats: message count, feedback events, task results, token usage, cost |
| **D6** | Beta Dashboard UI | New "Beta" tab in Dashboard showing user-level and session-level stats |
| **D7** | Feedback timeline | Chronological list of all feedback events for a user, filterable by type |

### Phase 3: Operational Runbook (P0)

| ID | Deliverable | Description |
|----|------------|-------------|
| **D8** | `docs/runbooks/private-beta-runbook.md` | Operational runbook: onboarding flow, monitoring checklist, escalation paths, known limitations |
| **D9** | Beta user onboarding guide | Simple instructions for beta users: how to use, how to give feedback, known limitations |

### Phase 4: Cost/Token Tracking (P1)

| ID | Deliverable | Description |
|----|------------|-------------|
| **D10** | Token tracking in SSE done event | Add `tokens: { input, output, total }` to SSE done event payload |
| **D11** | Cost calculation | Add `cost: { estimated_usd, provider, model }` to SSE done event payload |
| **D12** | Cost display in ActionBar | Show token count and estimated cost per message in ActionBar |

---

## Non-Goals (Deferred to S98P+)

- No multi-tenant isolation
- No A/B testing framework
- No automated feedback analysis / sentiment
- No alerting/paging integration
- No user management UI (manual onboarding)
- No feedback aggregation across users
- No NPS/satisfaction scoring
- No production load testing

---

## Key Design Decisions

### D1-D3: Thumbs-down reason

```typescript
// API extension
POST /api/feedback
{
  decision_id: string,
  feedback_type: "thumbs_down",
  reason?: string  // max 200 chars, optional
}

// DB migration
ALTER TABLE feedback_events ADD COLUMN feedback_reason TEXT;
```

### D4-D7: Beta stats

```typescript
// GET /api/beta/stats/:userId response
{
  userId: string,
  totalSessions: number,
  totalMessages: number,
  feedback: {
    total: number,
    thumbsUp: number,
    thumbsDown: number,
    ratio: number  // up / total
  },
  tasks: {
    total: number,
    completed: number,
    failed: number,
    cancelled: number,
    timedOut: number,
    avgDurationMs: number
  },
  tokens: {
    totalInput: number,
    totalOutput: number,
    estimatedCostUsd: number
  }
}
```

### D10-D12: Cost display

SSE `done` event extension (additive, backward compatible):
```typescript
{
  ...existing,
  usage?: {
    tokens: { input: number, output: number, total: number },
    cost: { estimated_usd: number, provider: string, model: string }
  }
}
```

---

## File Changes Plan

| File | Type | Deliverable |
|------|------|-------------|
| `frontend/src/components/chat/MessageBubble.tsx` | Modify | D1: Thumbs-down reason modal |
| `frontend/src/lib/api.ts` | Modify | D1: sendFeedback reason param |
| `src/api/chat.ts` | Modify | D2: Accept reason in feedback POST |
| `src/db/migrations/022_s97p_feedback_reason.sql` | New | D3: feedback_reason column |
| `src/api/beta.ts` | New | D4-D5: Beta stats endpoints |
| `src/db/repositories.ts` | Modify | D4-D5: Beta stats queries |
| `frontend/src/components/dashboard/BetaPanel.tsx` | New | D6: Beta Dashboard panel |
| `frontend/src/components/dashboard/FeedbackTimeline.tsx` | New | D7: Feedback timeline |
| `frontend/src/app/page.tsx` | Modify | D6: Add "Beta" tab |
| `src/services/phase3/sse-poller.ts` | Modify | D10-D11: Token/cost in done event |
| `frontend/src/components/chat/ActionBar.tsx` | Modify | D12: Cost display |
| `docs/runbooks/private-beta-runbook.md` | New | D8: Runbook |
| `docs/runbooks/beta-user-guide.md` | New | D9: User guide |

---

## Acceptance Criteria

| Criterion | Target |
|-----------|--------|
| Thumbs-down reason collected and stored | ✅ |
| Beta stats API returns correct per-user/session data | ✅ |
| Beta Dashboard tab visible with real data | ✅ |
| Feedback timeline shows chronological events | ✅ |
| Token/cost displayed in ActionBar | ✅ |
| Runbook covers onboarding + monitoring + escalation | ✅ |
| No regression on S96P benchmark (10/10) | ✅ |
| All new endpoints return 200 with valid X-User-Id | ✅ |
| Privacy: no PII in feedback_reason, no prompt/content exposure | ✅ |
