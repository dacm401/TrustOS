# TC-008 Review: Runtime Flow Documentation

## Card Summary

| Field | Value |
|---|---|
| **Card** | TC-008 Runtime Flow Documentation |
| **Sprint** | Sprint 02: Repository Cleanup and Runtime Foundation Hardening |
| **Type** | Documentation only |
| **Status** | ✅ Complete |

---

## Deliverables

### 1. `docs/runtime-flow.md` — Created ✅

Comprehensive runtime flow documentation covering:

- **High-level request flow** — ASCII diagram of the full `POST /api/chat` path
- **12-step runtime walkthrough** — detailed step-by-step for every operation in the chat handler
  - Route entry (Step 0)
  - Intent analysis (Step 1) — `intent-analyzer.ts` + `complexity-scorer.ts`
  - Model routing (Step 2) — `rule-router.ts` with full scoring table
  - Task creation (Step 3)
  - Prompt assembly (Step 4) — `prompt-assembler.ts`, direct vs research
  - Context management (Step 5) — `context-manager.ts`, compression flow
  - Model call (Step 6) — `model-gateway.ts`, provider dispatch
  - Quality gate (Step 7) — fast-path only, fallback behavior
  - Decision logging (Step 8) — `decision-logger.ts`
  - Learning engine (Step 9) — `learning-engine.ts`
  - Task execution update (Step 10)
  - Trace writes (Step 11)
  - Response (Step 12)
- **File / Module map** — organized by layer
- **Data touchpoints** — task, memory, decision log, growth profile
- **Task API routes** — all 4 endpoints with Hono routing shadowing note
- **Known quirks** — 7 items documented (Q1–Q7)
- **Suggested future cleanup** — 7 items by priority
- **Convention** — ISO 8601 for outward API, Unix ms for internal DB

### 2. `docs/repo-map.md` — Updated ✅

- Replaced verbose Runtime Flow Overview with a pointer to `docs/runtime-flow.md`
- Added quality-gate and learning-engine to the services/features listing
- Updated task routes to show trace type details

---

## Decisions Made

### D1: Keep the doc focused on actual behavior, not idealized architecture

No hypotheticals. Every claim was verified against the source code before writing.

### D2: 7 quirks documented instead of swept

Notable ones:
- Q1: SQL placeholder count mismatch in `DecisionRepo.save()` — non-blocking but should be fixed
- Q2: Summary 404 for new tasks is expected behavior — now explicitly documented
- Q4: Identity DB read on every chat request — future caching candidate
- Q7: Internal time format inconsistency in `identity_memories` — follow-up to TC-007

### D3: Hono routing shadowing explicitly called out

`:task_id/summary` and `:task_id/traces` must register before `:task_id` to avoid shadowing. This is a real gotcha that caused a bug before TC-001 review doc captured it.

### D4: Quality gate is fast-path-only behavior documented

The quality gate only applies when `selected_role === "fast"`. This was already true in the code but not documented.

### D5: Fire-and-forget operations tracked as a pattern

Task creation, trace writes, decision logging, learning engine, and task execution update are all fire-and-forget. This is now explicitly listed so future developers understand the non-blocking semantics.

---

## Regression Notes

- No code changes in this card. TypeScript build passes with zero errors.
- `docs/repo-map.md` update only changes the Runtime Flow Overview section; no file paths changed.
- All references in the new doc are consistent with Sprint 02 structure:
  - `context-manager.ts` at `services/`
  - `decision-logger.ts` at `logging/`
  - `learning-engine.ts` at `features/`
  - No references to `observatory/` or `evolution/`

---

## Scope Adherence

| Planned | Delivered |
|---|---|
| Document `POST /api/chat` flow | ✅ |
| Identify route / service / repository / prompt / model call | ✅ |
| Document task / summary / trace touchpoints | ✅ |
| Note known quirks and fallback behavior | ✅ |
| No behavior change | ✅ |
| No architecture redesign | ✅ |
| Match actual implementation | ✅ |

---

## File Changes

```
docs/runtime-flow.md              — NEW
docs/repo-map.md                  — UPDATED (Runtime Flow Overview section)
docs/task-cards/008-runtime-flow-documentation-review.md  — NEW (this file)
```

---

## Next Sprint Direction

With Sprint 02 complete, the foundation is solid:
- Directory structure ✅
- Runtime boundaries ✅
- API consistency ✅
- Runtime flow ✅

Next logical sprint: **Memory v1** — `taskSummary` injection into `prompt-assembler`, `MemoryRepo` population during task lifecycle, `analyzeAndLearn()` stub replacement. The runtime-flow doc's Section 7 "Suggested Future Cleanup" provides the prioritized backlog.

---

_Document date: 2026-04-08_
