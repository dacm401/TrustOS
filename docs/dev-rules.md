# Dev Rules

This document defines the engineering rules, architecture boundaries, and AI collaboration rules for this repository.

---

## 1. Architecture Rules

### 1.1 Task-Centric Design
- The core object of the system is the task, not raw message history.
- New capabilities should attach to task lifecycle whenever possible.

### 1.2 State Management
- All task status transitions must go through a centralized state machine or state transition service.
- Controllers and routes must not change task states directly unless explicitly delegated.

### 1.3 Prompt Assembly
- Prompts must not be assembled directly in controllers or routes.
- Prompt generation must go through a dedicated PromptAssembler.
- Prompt modules should be structured and composable.

### 1.4 Model Access
- All model calls must go through a unified model provider interface.
- No business logic module should directly hardcode vendor-specific model calls.

### 1.5 Memory and Evidence
- Evidence must preserve source metadata.
- Memory entries must be editable and deletable.
- Memory writes should be governed and not based on raw chat dumping.

### 1.6 Separation of Concerns
- Controllers handle request/response only.
- Services contain business logic.
- Database access should be encapsulated and kept clear.
- Avoid hidden cross-module coupling.

---

## 2. Engineering Rules

### 2.1 Incremental Development
- Prefer small, incremental changes over large rewrites.
- One feature card should ideally produce one coherent code batch.

### 2.2 Validation
- New APIs must include request validation schema.
- All outputs should be structured and predictable.

### 2.3 Testing
- Every new feature must include at least minimal verification steps.
- Prefer adding repeatable test cases for important behaviors.

### 2.4 Logging and Traceability
- Important flows should emit traceable logs.
- Significant runtime actions should be recordable via trace entities.

### 2.5 Data Integrity
- Avoid introducing fields without a documented purpose.
- Prefer explicit fields over ambiguous metadata blobs when the structure is stable.

---

## 3. AI Collaboration Rules

### 3.1 Required Output Order
When asking an AI to implement a feature, require the following order:
1. implementation plan
2. files to change
3. code changes
4. test steps
5. review checklist

### 3.2 Change Size
- Limit each AI-generated code batch to roughly 3-5 files where practical.
- Avoid asking AI to rewrite large unrelated areas.

### 3.3 Scope Control
- AI must respect the task card scope.
- AI must not modify unrelated modules unless explicitly approved.

### 3.4 Verification Requirement
- Every code generation batch must include:
  - run commands
  - expected results
  - known risks

### 3.5 Refactor Discipline
- Refactors must be justified.
- Refactors should not be mixed with unrelated feature work when avoidable.

---

## 4. Current Non-Negotiables

- Do not place core business logic in controllers.
- Do not hardcode prompt strings across multiple places.
- Do not let task lifecycle logic spread randomly.
- Do not treat memory as a raw vector dump.
- Do not add autonomous execution without budget controls.
- Do not optimize prompts without benchmark awareness.

---

## 5. Working Principle

The system should evolve toward:
- task-oriented orchestration
- modular prompt composition
- controlled retrieval and execution
- measurable iteration quality

Short version:
**stable architecture first, faster generation second**
