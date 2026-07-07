# S100P Demo Script — Manager Workspace v1

Sprint: S100P — Manager Workspace v1: Loop Separation in UX
Date: 2026-07-07

---

## Prerequisites

- Backend server running on port 3001
- Frontend dev server running on port 3000
- User identity configured (any valid `X-User-Id`)

---

## Demo Flow (6 Steps)

### Step 1: Open Manager Workspace

Navigate to the app. The chat view should display the three-column Manager Workspace.

**Verify:**
- Left panel: Session List (empty initially)
- Center panel: Manager Conversation (empty input area)
- Right panel: Session Detail (empty state, "选择一个 Session")
- Three columns are independently scrollable
- Each column has a visible header label

**Pass Condition:** Three columns visible, left/right empty on first load.

---

### Step 2: Send Normal Message

Type: `你好，今天状态怎么样？`

**Verify:**
- Center panel: New manager message appears (user message + manager response)
- Left panel: No new session created
- Right panel: No new event appears
- API response: `routeType = "normal_conversation"`, `createdSession = null`

**Pass Condition:** Only center panel changes. Session List unchanged. Session Detail unchanged.

---

### Step 3: Create Delegated Task

Type: `帮我修登录页 UI，不要碰认证逻辑。`

**Verify:**
- Center panel: Manager summary appears ("已创建委托任务：帮我修登录页 UI...")
- Left panel: New session card appears (title = "帮我修登录页 UI", status = "planning", risk = "low")
- Right panel: Session Detail auto-selects the new session
  - Shows: title, goal, status, risk level, Delegation Contract
  - Shows: event timeline with `session.created` event
- API: `routeType = "new_delegated_task"`, `createdSession.id` present, `sessionEvent.type = "session.created"`

**Pass Condition:** All three panels update correctly. Session created with event.

---

### Step 4: Select Session Manually

Click the Session card in the left panel.

**Verify:**
- Right panel updates with session details (title, goal, status, delegation contract)
- Event timeline shows existing events
- Center panel remains unchanged (previous conversation history preserved)
- Left panel highlights the selected session

**Pass Condition:** Selecting a session only updates the right panel. Center panel is stable.

---

### Step 5: Update Session by Reference

Type: `登录页面那个任务，再加个验证码。`

**Verify:**
- Center panel: Manager summary appears ("已更新任务：帮我修登录页 UI")
- Right panel (Session Detail): New `session.updated` event appears in timeline
- Left panel: No new session created (same session updated)
- API: `routeType = "update_existing_session"`, `targetSessionId` matches the session from Step 3

**Pass Condition:** Chinese n-gram reference correctly matches existing session. No duplicate session.

---

### Step 6: Confirm Event Boundary

This is the most important verification.

**Check 6a: Center panel (Manager Conversation)**
- Contains only `manager_messages` (user prompts + manager responses)
- No session event timeline entries
- No event type/visibility metadata visible

**Check 6b: Right panel (Session Detail)**
- Contains only `session_events`
- No user/manager chat messages mixed in
- Events show type icons, visibility badges, summaries

**Check 6c: Left panel (Session List)**
- Shows distinct sessions
- No message or event content leaked into session cards
- Status indicators reflect current session state

**Pass Condition:** Zero cross-contamination between manager_messages and session_events.

---

## Verification Quick Reference

| Step | Action | API Route Type | Session List | Center Panel | Right Panel |
|---|---|---|---|---|---|
| 2 | 你好 | normal_conversation | — | ↑ message | — |
| 3 | 帮我修登录页UI | new_delegated_task | ↑ new session | ↑ summary | ↑ session.created |
| 4 | Click session | — | highlight | — | ↑ detail |
| 5 | 再加个验证码 | update_existing_session | — | ↑ summary | ↑ session.updated |
| 6 | Boundary check | — | sessions only | messages only | events only |

---

## Smoke Script

Run automated verification:

```bash
node scripts/smoke/s100p-phase3-smoke.mjs
```

Expected: 21/21 PASS.

This script validates the full API wiring without requiring a browser, ensuring:
- Session CRUD
- Manager route-message (4 route types)
- Message persistence
- Event persistence
- Event boundary separation
