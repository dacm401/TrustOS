# MWT-4B Export JSON Schema (Candidate)

> **Status**: DRAFT — DOCUMENTATION_ONLY ✅ (schema defined, NOT implemented)
> **Purpose**: Specify the candidate export payload structure so a builder can be written deterministically later.
> Companion: `MWT-4B-export-scope-spec.md`.

---

## Candidate Top-Level Structure

```json
{
  "schema_version": "mwt4b.export.v0",
  "export_type": "client_generated_unsigned_task_evidence_snapshot",
  "generated_at": "2026-08-10T12:00:00.000Z",
  "task_id": "task_abc123",
  "session_id": "session_xyz789",
  "trust_boundary": {
    "generated_by": "client",
    "signed": false,
    "attestation": false,
    "system_of_record": false
  },
  "summary": {
    "event_count": 0,
    "total_cost_usd": 0,
    "total_tokens": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "allow_count": 0,
    "deny_count": 0,
    "unknown_decision_count": 0
  },
  "timeline": [],
  "hashes": [],
  "exclusions": []
}
```

### `timeline` element (candidate)

```json
{
  "event_id": "evt_...",
  "event_type": "model_call",
  "timestamp": "2026-08-10T12:00:01.000Z",
  "summary": "model call to deepseek-ai/DeepSeek-V4-Flash",
  "decision": "allow"
}
```

### `hashes` element (candidate)

```json
{
  "event_id": "evt_...",
  "event_hash": "20cc7b7f...",
  "input_hash": "7d644149...",
  "output_hash": "fd3101fd..."
}
```

### `exclusions` element (candidate)

```json
{
  "field": "raw_prompt",
  "reason": "privacy: raw content excluded by design"
}
```

---

## Field Classification

### Mandatory (must always be present)

- `schema_version` — fixed `"mwt4b.export.v0"`
- `export_type` — fixed `"client_generated_unsigned_task_evidence_snapshot"`
- `generated_at` — ISO-8601 UTC timestamp
- `task_id` — the task correlation id (string, non-null because export is task-scoped)
- `trust_boundary` — object with all four boolean/string fields
- `trust_boundary.generated_by` — `"client"`
- `trust_boundary.signed` — `false`
- `trust_boundary.attestation` — `false`
- `trust_boundary.system_of_record` — `false`
- `summary` — object with all numeric fields (may be 0)
- `exclusions` — array (may be empty, but field must exist)

### Optional (present only when safely available)

- `session_id` — include only if the frontend already safely holds it for the task; otherwise omit the key (do NOT send `null`/`""`).
- `timeline` — empty array allowed for empty task.
- `hashes` — empty array allowed for empty task.

### Prohibited (must NEVER appear)

- `raw_prompt`, `raw_output`, `raw_content`
- `api_key`, `secret`, `provider_raw_payload`
- `run_id`, `trace_id` (unless separately authorized later)
- `signature`, `certificate`, `hmac`
- `attestation_verdict`, `approval_status`, `policy_decision`
- `system_of_record = true`

---

## Hash Semantics Limitation

- Hashes in the export are **pass-through only** — copied from source events' existing `event_hash` / `input_hash` / `output_hash`.
- The export does **not** recompute, re-derive, or verify hashes.
- Hash presence/absence reflects the source event; missing hash is reported honestly (no fabrication).

---

## Unsigned Label Requirement

The `trust_boundary.signed = false` field **must** appear inside the export payload itself (not only in UI). Any consumer reading the JSON can determine the export is unsigned without external context.

The export SHOULD also include a human-readable note string (e.g. inside `exclusions` or a dedicated `notice` field) stating:

> This export is client-generated and unsigned. It is a projection snapshot, not a system-of-record attestation. Raw prompts and raw outputs are excluded.
