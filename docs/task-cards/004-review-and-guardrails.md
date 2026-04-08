# Task Card 004: Review + Guardrails

## Goal
Regression verification, documentation, and safety guardrails for Memory v1.

---

## Scope

### Guardrails (enforced in API layer)

| Guard | Rule |
|---|---|
| Entry size | `content` max 2000 characters per entry |
| Entry importance | Must be 1–5, coerced to range |
| Tags | Max 10 tags per entry, each max 50 chars |
| List limit | Max 100 per request |
| Injection entries | Max `config.memory.maxEntriesToInject` |
| Injection tokens | Hard cap via `config.memory.maxTokensPerEntry` |

Enforce in `backend/src/api/memory.ts` and `prompt-assembler.ts`.

### Regression Testing
Manual regression for all affected endpoints:
```
POST /api/chat  direct mode    → must pass
POST /api/chat  research mode  → must pass
GET  /v1/tasks/all             → must pass
GET  /v1/tasks/:id             → must pass
GET  /v1/tasks/:id/summary     → must pass (404 for new tasks is expected)
GET  /v1/tasks/:id/traces      → must pass
POST /v1/memory                → must create entry
GET  /v1/memory                → must list entries
PUT  /v1/memory/:id            → must update entry
DELETE /v1/memory/:id          → must delete entry
```

### Documentation
Update `docs/runtime-flow.md`:
- Add memory injection step to the 12-step flow (Step 4b)
- Add `/v1/memory` routes to the Task API Routes section (or create separate section)
- Document the injection policy and token budget

Update `docs/repo-map.md`:
- Add `backend/src/api/memory.ts` to API Routes
- Add `memory_entries` to the data model mention

### MC-001/002/003 Review Docs
Write review docs for MC-001, MC-002, MC-003 if not already done in those cards' scope.

---

## Non-Goals
- Load testing
- Multi-user isolation beyond `user_id`
- Performance optimization of memory reads

---

## Acceptance Criteria
- All regression endpoints pass
- All guardrails are enforced and tested
- `docs/runtime-flow.md` reflects Memory v1 injection path
- `docs/repo-map.md` includes memory API routes
- 3 review docs exist for MC-001/002/003
- This review doc (MC-004) exists

---

## File Changes
```
backend/src/api/memory.ts           — ADD validation guardrails
backend/src/services/prompt-assembler.ts  — ADD token cap
docs/runtime-flow.md               — UPDATE
docs/repo-map.md                    — UPDATE
docs/task-cards/001-memory-data-model-and-repository-review.md   — NEW
docs/task-cards/002-memory-crud-apis-review.md                  — NEW
docs/task-cards/003-memory-prompt-injection-review.md           — NEW
docs/task-cards/004-review-and-guardrails-review.md              — NEW (this file)
```
