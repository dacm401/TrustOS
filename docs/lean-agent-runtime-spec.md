# Lean Agent Runtime - Spec v1

## 1. Product Vision

SmartRouter Pro is a Lean Agent Runtime (LAR): a system that keeps interaction lightweight by default and escalates to agent-like behavior only when needed.

The system is built around **task as the core unit**, not raw message history.

Design philosophy:
- **stable architecture first, faster generation second**
- **controllability over capability**
- **explicit over implicit**

---

## 2. Core Entities

### Task
Central object of the system. Represents a unit of work from user intent to completion.

Fields:
- `task_id`: unique identifier
- `session_id`: conversation session
- `title`: short task name
- `mode`: direct | research | execute
- `status`: pending | running | waiting_subagent | completed | failed | blocked
- `complexity`: low | medium | high
- `risk`: low | medium | high
- `goal`: user-provided or inferred task goal
- `budget_profile`: token/compute budget for this task
- `tokens_used`: accumulated token count
- `tool_calls_used`: count of tool invocations
- `steps_used`: count of execution steps
- `summary_ref`: reference to summary entity
- `created_at`, `updated_at`

### Summary
Structured reflection of task state.

Fields:
- `summary_id`
- `task_id`
- `goal`
- `confirmed_facts`: string[]
- `completed_steps`: string[]
- `blocked_by`: string | null
- `next_step`: string
- `summary_text`: free-form summary
- `version`: number
- `updated_at`

### Trace
Runtime event log for debugging and inspection.

Fields:
- `trace_id`
- `task_id`
- `type`: classification | routing | response | tool_call | error
- `detail`: structured payload (JSON string)
- `created_at`

### Evidence
Retrievable source data with provenance.

Fields:
- `evidence_id`
- `task_id`
- `content`
- `source`: source identifier
- `source_metadata`: provenance info
- `relevance_score`: optional
- `created_at`

### Memory
Persistent, editable knowledge entry.

Fields:
- `memory_id`
- `content`
- `tags`: string[]
- `created_by`: task_id or manual
- `created_at`, `updated_at`

---

## 3. Execution Modes

### Direct Mode
- Single request-response cycle
- No state persistence between turns beyond chat history
- Fast, low-cost

### Research Mode
- Multi-step with task planning
- Builds task summary over time
- May use classification and routing
- Medium complexity

### Execute Mode
- Tool execution loop
- Budget-controlled autonomous steps
- Highest capability, highest cost
- Not yet implemented

---

## 4. Routing

### Classification
Classifies user message into mode (direct/research/execute) using a lightweight model.

### Rule-Based Routing
Routes to specific model based on:
- mode
- complexity
- risk level

Default routing:
- `direct + low complexity` → fast/cheap model
- `research + any complexity` → capable model
- `execute` → most capable model

---

## 5. API Surface

### Chat API
```
POST /api/chat
Body: { user_id, session_id, message, history }
Response: { message, routing: { model, mode, reasoning }, trace_ids }
```

### Task APIs
```
GET  /v1/tasks
GET  /v1/tasks/:task_id
GET  /v1/tasks/:task_id/summary
GET  /v1/tasks/:task_id/traces
```

### Dashboard APIs
```
GET /api/dashboard/:user_id
GET /api/growth/:user_id
```

### Feedback API
```
POST /api/feedback
Body: { decision_id, feedback_type }
```

---

## 6. Architecture Principles

### Prompt Assembly
All prompts go through PromptAssembler - no inline prompt strings in controllers or services.

### State Management
Task state transitions go through TaskStateMachine - no direct DB writes from controllers.

### Model Access
All LLM calls go through a unified model provider (OpenAI-compatible) - no vendor-specific logic in business modules.

### Memory & Evidence
Evidence preserves source metadata. Memory entries are editable and deletable. No raw vector dump.

### Separation of Concerns
- Routes/controllers: request/response only
- Services: business logic
- Repositories: data access

---

## 7. Current Sprint: Backend Foundation Upgrade

See `docs/current-sprint.md` for scope and acceptance criteria.

Feature cards:
- 001: Task List and Detail API
- 002: Task Summary API
- 003: Trace API
- 004: PromptAssembler v1

---

## 8. Evaluation

Benchmark cases stored in `evaluation/cases/`:
- `direct/`: direct mode test cases
- `research/`: research mode test cases
- `execute/`: execute mode test cases (when implemented)

Reports in `evaluation/reports/`.

---

## 9. Development Rules

See `docs/dev-rules.md` for full engineering and AI collaboration rules.

Non-negotiables:
- No core business logic in controllers
- No hardcoded prompt strings across multiple places
- No scattered task lifecycle logic
- No autonomous execution without budget controls
- No prompt optimization without benchmark awareness
