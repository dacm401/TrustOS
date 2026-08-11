# MWT-4B Negative Test Cases

> **Status**: DOCUMENTATION_ONLY ✅ — negative test specs, no test code.
> **Companion**: `MWT-4B-export-test-plan.md` (sections 3–6), `MWT-4B-export-privacy-checklist.md`.
> **Last updated**: 2026-08-10

---

## N1 — Raw Content Leak Negative

- Input: F5 poisoned fixture.
- Assert: serialized output contains NONE of `raw_prompt`, `raw_output`, `api_key`, `secret`, `provider_raw_payload`.
- Assert: `exclusions` enumerates each stripped field.

## N2 — Unsigned Label Negative

- Assert `trust_boundary.signed === false`.
- Assert no `signature`, `certificate`, `hmac` key exists anywhere in payload.

## N3 — No Attestation Wording Negative

- Scan serialized JSON for forbidden claim keywords: `attest`, `certified`, `verified`, `approved`, `signed` (except `signed: false` field + unsigned notice string).
- Assert zero forbidden matches.

## N4 — No Backend Call Negative

- Spy `fetch` / API client during `buildExportPayload`.
- Assert zero network calls. Builder depends only on passed `taskEvidence`.

## N5 — No Policy Coupling Negative

- Assert output contains no `policy_decision`, `approval_status`, `enforcement`.
- Assert `allow_count`/`deny_count`/`unknown_decision_count` are pass-through from projection only.

## N6 — No run_id / trace_id Negative

- Assert neither `run_id` nor `trace_id` key appears in payload under any nesting.
- Fuzz: inject event with `run_id`/`trace_id` → must be dropped.

## N7 — Malformed Event Negative

- Input: event with unexpected nested object / huge string.
- Assert builder does not throw; unexpected fields dropped; required fields intact.

## N8 — Null TaskEvidence Negative

- Input: `taskEvidence = null` or `undefined`.
- Assert builder throws typed error OR returns empty valid payload (decide at implementation; test encodes the chosen contract).

## N9 — session_id Null Negative

- Input: `session_id = null`/`""`.
- Assert key OMITTED (not `null`/`""`) in output.

## N10 — System-of-Record Claim Negative

- Assert `trust_boundary.system_of_record === false`.
- Assert no phrasing implying durable record / certified evidence.
