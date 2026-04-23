# Task Card 006: Prompt and Runtime Module Cleanup

## Goal
Place prompt-related and runtime-related logic into clearer module locations without changing behavior.

---

## Scope
- review placement of PromptAssembler and related runtime logic
- move files only where clarity improves significantly
- keep imports updated
- preserve existing behavior

---

## Non-Goals
- prompt feature expansion
- memory injection
- evidence injection
- model provider redesign

---

## Acceptance Criteria
- prompt-related code is easier to find
- runtime module boundaries are clearer
- /api/chat behavior remains unchanged
