# MWT-4B Export Exclusion Rules

> **Status**: DOCUMENTATION_ONLY ✅ — machine-enforceable exclusion rules.
> **Companion**: `MWT-4B-export-field-allowlist.md`, `MWT-4B-export-privacy-checklist.md`, `MWT-4B-negative-test-cases.md`.
> **Last updated**: 2026-08-10

---

## Rule E1 — Raw Content Exclusion
Exclude any field whose name or value matches: `raw_prompt`, `raw_output`, `raw_content`, `prompt_text`, `output_text`.
Enforced by: N1, RT1, RT2.

## Rule E2 — Secret Exclusion
Exclude: `api_key`, `secret`, `token`, `password`, `credential`, `authorization`.
Enforced by: N1, RT3.

## Rule E3 — Provider Payload Exclusion
Exclude: `provider_raw_payload`, `request_body`, `response_body`, `full_trace`.
Enforced by: N1, RT2.

## Rule E4 — Identity Link Exclusion
Exclude: `run_id`, `trace_id`, `trace_id_chain`.
Enforced by: N6, RT4.

## Rule E5 — Trust Primitive Exclusion
Exclude: `signature`, `certificate`, `hmac`, `signature_algorithm`.
Enforced by: N2.

## Rule E6 — Governance Exclusion
Exclude: `approval_status`, `policy_decision`, `enforcement`, `attestation_verdict`.
Enforced by: N3, N5, RT5.

## Rule E7 — System-of-Record Exclusion
`trust_boundary.system_of_record` MUST be `false`; no phrasing implying durable certified record.
Enforced by: N10, RT6.

## Rule E8 — Allowlist-Only Emission
Builder emits ONLY allowlisted keys (see field-allowlist). Any non-listed key dropped.
Enforced by: N7 (malformed), N9 (session_id null).

## Rule E9 — Honest Missing Hash
If source `event_hash` is null/absent, export `event_hash: null` (no fabrication).
Enforced by: F4 fixture + builder test.

## Exclusion Audit
Each rule maps to ≥1 negative/red-team test. No rule may be "document-only" at MWT-4B seal — must have executable enforcement.
