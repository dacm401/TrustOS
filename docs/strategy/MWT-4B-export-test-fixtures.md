# MWT-4B Export Test Fixtures (Design)

> **Status**: DOCUMENTATION_ONLY ✅ — fixture design, no test code.
> **Companion**: `MWT-4B-export-test-plan.md`, `MWT-4B-negative-test-cases.md`.
> **Last updated**: 2026-08-10

---

## Fixture Principles

1. Deterministic — seeded, no live Gateway, no clock-dependence in assertions (inject `generated_at`).
2. Reuse MWT-4A `aggregateTaskEvidence` pure-function fixtures.
3. Each fixture maps to a test in `MWT-4B-export-test-plan.md`.

## Fixture Inventory

### F1 — Empty Task
```json
{
  "task_id": "task_empty",
  "events": []
}
```
Expected export: `event_count: 0`, empty `timeline`, empty `hashes`, valid required fields.

### F2 — Clean Task (3 model_calls, all allow)
```json
{
  "task_id": "task_clean",
  "events": [
    { "event_id": "evt_1", "event_type": "model_call", "decision": "allow",
      "event_hash": "a1", "input_hash": "b1", "output_hash": "c1", "summary": "call 1" },
    { "event_id": "evt_2", "event_type": "model_call", "decision": "allow",
      "event_hash": "a2", "input_hash": "b2", "output_hash": "c2", "summary": "call 2" },
    { "event_id": "evt_3", "event_type": "model_call", "decision": "allow",
      "event_hash": "a3", "input_hash": "b3", "output_hash": "c3", "summary": "call 3" }
  ]
}
```
Expected: `event_count: 3`, `allow_count: 3`, `deny_count: 0`, `unknown_decision_count: 0`.

### F3 — Mixed Decisions
```json
{
  "task_id": "task_mixed",
  "events": [
    { "event_id": "evt_1", "decision": "allow", "event_hash": "a1", "input_hash": "b1", "output_hash": "c1" },
    { "event_id": "evt_2", "decision": "deny", "event_hash": "a2", "input_hash": "b2", "output_hash": "c2" },
    { "event_id": "evt_3", "decision": "unknown", "event_hash": "a3", "input_hash": "b3", "output_hash": "c3" }
  ]
}
```
Expected: `allow_count: 1`, `deny_count: 1`, `unknown_decision_count: 1`.

### F4 — Missing Hash (honest representation)
```json
{
  "task_id": "task_missing_hash",
  "events": [
    { "event_id": "evt_1", "decision": "allow", "event_hash": null, "input_hash": "b1", "output_hash": "c1" }
  ]
}
```
Expected: hash object present with `event_hash: null` (no fabrication).

### F5 — Poisoned Fixture (must be stripped)
```json
{
  "task_id": "task_poisoned",
  "events": [
    { "event_id": "evt_1", "decision": "allow", "event_hash": "a1",
      "raw_prompt": "SECRET PROMPT", "raw_output": "SECRET OUTPUT",
      "api_key": "sk-xxxx", "provider_raw_payload": "{...}" }
  ]
}
```
Expected: all poisoned fields ABSENT in output; present in `exclusions`.

### F6 — Session-Scoped (optional session_id)
```json
{
  "task_id": "task_session",
  "session_id": "session_xyz",
  "events": [ { "event_id": "evt_1", "decision": "allow", "event_hash": "a1", "input_hash": "b1", "output_hash": "c1" } ]
}
```
Expected: `session_id` retained (safely available); absent if not provided.

## Fixture Storage (design only)

- Location (proposed): `scripts/mwt4b/fixtures/*.json` — created only at implementation time.
- This doc defines shape; no file written now.
