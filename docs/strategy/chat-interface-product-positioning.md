# ChatInterface Product Positioning

> **Status**: RESTORED_AS_CONDITIONAL ✅ (PM decision 2026-08-07)
> **PM Directive**: "Keep ChatInterface for now. Classify as primary demo interaction surface for generating TrustOS-observed AI events."
> **Dependencies**: TRST-4X Console Surface Rebaseline

---

## 1. What ChatInterface Is

ChatInterface is a chat-style AI interaction surface within the TrustOS Console.
Users type prompts and receive AI responses in a familiar message-bubble interface.

**Current function**: Direct chat with AI models via the WorkBuddy backend (`${apiBase}/api/chat`).

**NOT**: A ChatGPT alternative. NOT a standalone chat product. NOT a TrustOS enforcement surface.

---

## 2. Product Classification

```
Primary demo interaction surface for generating TrustOS-observed AI events.
```

It exists to allow users to generate AI events that can then be observed,
recorded, and evidenced through the TrustOS governance pipeline:

```
Chat → [future: Gateway] → Event → Evidence → Report
```

---

## 3. Current Integration Status

### Gateway Integration: NOT_INTEGRATED ⚠️

| Aspect | Current | Target |
|--------|---------|--------|
| Chat API endpoint | `${apiBase}/api/chat` (WorkBuddy backend) | Should route through Gateway |
| Event generation | Indirect (backend creates tasks) | Should produce Gateway events |
| Evidence linkage | None | Chat events → Evidence report |
| Privacy/redaction | Unknown | Must comply with TrustOS privacy model |
| Streaming | Worker-based SSE | TRST-4B streaming |

**Status**: `ChatInterface: UI_RESTORED_BUT_NOT_TRUSTOS_INTEGRATED ⚠️`

This means ChatInterface currently operates outside the TrustOS observe→evidence pipeline.
Events generated through Chat are NOT automatically captured by the Gateway.

---

## 4. Relationship to Other Components

### 4.1 ChatInterface ↔ Gateway

- **Current**: No connection. Chat bypasses Gateway.
- **Required**: Chat API calls should be proxied through Gateway so events are captured.
- **Action**: TRST-4H or future charter to wire Chat → Gateway path.

### 4.2 ChatInterface ↔ Events

- **Current**: Chat creates backend tasks, not Gateway events.
- **Required**: Chat interactions should appear in EventChainViewer.
- **Action**: Once Gateway integration is live, events auto-appear.

### 4.3 ChatInterface ↔ Evidence

- **Current**: No evidence linkage.
- **Required**: Chat sessions should generate evidence reports.
- **Action**: Depends on Gateway integration.

### 4.4 ChatInterface ↔ ManagerWorkspace

- **ManagerWorkspace**: Agent session management UI (B-class retained, hidden from main nav)
- **ChatInterface**: Direct chat interaction surface (A-class restored per user request)
- **Relationship**: Both are AI interaction surfaces but serve different purposes:
  - ChatInterface = simple chat for generating observed events
  - ManagerWorkspace = agent session orchestration
- **No duplication**: ChatInterface is simpler/direct; ManagerWorkspace is session-aware

---

## 5. Chat Interface Boundaries (PM Mandated)

These boundaries MUST be maintained:

1. ✅ Chat is a **demo interaction surface**, not the TrustOS product itself
2. ✅ Chat does NOT claim TrustOS intercepts, blocks, or enforces
3. ✅ Chat does NOT store/display raw content that conflicts with evidence/privacy policy
4. ✅ Chat must route through Gateway (or be flagged as demo-only until it does)
5. ✅ Chat output must appear in Events/Evidence/Overview once Gateway integration is complete
6. ✅ Chat UI must include boundary disclaimer text

---

## 6. Required UI Disclaimer

ChatInterface should display (e.g., above input area or as tooltip):

> This chat is a demo surface for generating TrustOS-observed AI events.
> TrustOS records privacy-safe evidence and does not store raw prompts/outputs in reports.

---

## 7. Navigation Status

```
Current: 💬 Chat — Default homepage (Option A, PM: CONDITIONALLY ACCEPTED)
Mid-term: 🏠 Overview as default homepage, Chat renamed to "Demo Chat" (Option B, PM: RECOMMENDED)
```

Per PM decision 2026-08-07: Option A accepted short-term, migrate to Option B medium-term.

---

## 8. Files in Scope

| File | Status | Notes |
|------|--------|-------|
| `ChatInterface.tsx` | Restored | Main chat component |
| `MessageBubble.tsx` | Restored | Message rendering |
| `DecisionCard.tsx` | Restored | Decision display |
| `CodeBlock.tsx` | Restored | Code highlighting |
| `PreviewPane.tsx` | Restored | Content preview |
| `ActionBar.tsx` | Restored | Message actions |
| `ModelSwitchAnim.tsx` | Restored | Model switch animation |
| `ThinkingIndicator.tsx` | Restored | Loading state |

---

## 9. Future Recommendations

| Timeline | Action |
|----------|--------|
| **Short-term** | Add UI disclaimer text |
| **Short-term** | Verify Chat → Gateway wiring feasibility |
| **Medium-term** | Migrate default homepage to Overview |
| **Medium-term** | Rename Chat → "Demo Chat" or "Generate Events" |
| **Long-term** | Chat → Gateway → Event → Evidence full pipeline |
| **Long-term** | Unify or clearly separate ChatInterface / ManagerWorkspace |

---

## 10. Decision Record

```
PM DECISION (2026-08-07):
  TRST-4X Console Surface Rebaseline: ACCEPTED IN PRINCIPLE ✅
  ChatInterface Restoration: ACCEPTED_AS_CONDITIONAL ✅
  ChatInterface Classification: Primary demo interaction surface
  Default homepage: Chat (Option A, conditional, short-term)
  Integration requirement: Must document Gateway/event/evidence relationship
```
