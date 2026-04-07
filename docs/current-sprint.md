# Current Sprint

## Sprint Name
Backend Foundation Upgrade

## Sprint Goal
Upgrade the current demo into a development-ready backend foundation for Lean Agent Runtime style evolution.

---

## In Scope

### APIs
- GET /v1/tasks
- GET /v1/tasks/:task_id
- GET /v1/tasks/:task_id/summary
- GET /v1/tasks/:task_id/traces

### Runtime
- PromptAssembler v1
- TaskStateMachine v1

### Engineering
- move prompt construction out of ChatService
- define task read DTOs
- stabilize response structure
- keep direct/research flow working after refactor

---

## Out of Scope

- complex frontend UI
- full memory write automation
- evidence retrieval implementation
- tool execution loop
- multi-agent architecture
- production deployment hardening

---

## Acceptance Criteria

### Task APIs
- task list endpoint works
- task detail endpoint works
- basic filtering works where practical
- response shape is stable and documented

### Summary API
- returns structured task summary
- handles missing summary gracefully

### Trace API
- returns trace list for a task
- supports frontend trace panel use later

### Prompt Assembler
- no prompt building logic remains embedded inside ChatService
- PromptAssembler can generate direct and research prompt structures

### State Machine
- task state transitions are no longer scattered
- status updates become more explicit and controlled

---

## Risks

- current demo code may contain tightly coupled logic
- refactor may break existing chat flow if done too broadly
- task status updates may still be partially duplicated at first

---

## Success Definition

At the end of this sprint:
- the repo has a clearer architecture
- backend APIs support task inspection
- prompt assembly is modularized
- runtime evolution can continue without turning into a spaghetti festival
