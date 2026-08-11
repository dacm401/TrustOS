# MWT-4B Export Scope Specification (v0)

> **Status**: DRAFT — DOCUMENTATION_ONLY ✅ (no implementation)
> **Purpose**: Define the exact scope of the MWT-4B Task Evidence Export v0 so implementation can proceed without ambiguity once PM greenlights.
> **NOT implementation authorization.** See `MWT-4B-implementation-plan-draft.md`.

---

## 1. MWT-4B v0 Goal

Provide a **frontend-only, client-generated, unsigned** export of a single task's evidence projection so a reviewer/operator can take a portable, human-readable snapshot of what TrustOS observed for that task — without introducing any backend service, durable store, signing, or policy semantics.

This is a **read-only projection of already-available frontend data**, not a new trust primitive.

---

## 2. Export is Frontend-Only Projection Snapshot

- The export is assembled **entirely in the browser** from data the frontend already holds via existing APIs (`/v1/events?task_id=<id>`).
- No new network endpoint. No new Gateway route. No new backend service.
- It is a **snapshot at click time** — not a live feed, not a subscription.

---

## 3. Unsigned

- The export carries **no cryptographic signature**.
- The payload explicitly marks `trust_boundary.signed = false`.
- No signing key, no certificate, no HMAC, no verification workflow.

---

## 4. No Raw Prompt / Output

- The export contains **no raw prompt text** and **no raw model output text**.
- Only hashes, metadata, counts, and timeline summaries are included.
- This matches the existing Gateway event model (`event_hash`, `input_hash`, `output_hash` only).

---

## 5. No Attestation

- The export makes **no claim that the content is true, complete, or verified**.
- It does not attest to system state, task completion, or event integrity beyond the hashes already present in source events.

---

## 6. No Approval / Policy Meaning

- The export does **not** represent approval, sign-off, compliance, or policy decision.
- Allow/Deny/Unknown counts are reported **only** as observed control-recommendation counts from the existing projection. They carry no policy enforcement meaning.

---

## 7. No Backend Service

- No durable evidence report is generated server-side.
- No new database table, no new API, no new Gateway endpoint.
- The backend is completely untouched by MWT-4B.

---

## 8. No Durable Evidence Store

- The export is a transient client artifact (download or copy).
- TrustOS does **not** persist the export as a system-of-record.
- Source of truth remains the existing JSONL event store + SQLite index.

---

## 9. Source Data (Allowed)

The export is built only from:

1. **task_id-scoped events** — events already queryable via `GET /v1/events?task_id=<id>` (MWT-3B1).
2. **MWT-4A evidence projection summary** — the aggregated `TaskEvidence` object produced by the existing `aggregateTaskEvidence` pure function (`frontend/src/lib/taskEvidence.ts`).
3. **Existing hashes only** — `event_hash`, `input_hash`, `output_hash` already present on source events. No new hash is computed by the export.

---

## 10. Excluded Data (Prohibited)

The export MUST NOT contain:

- raw prompt
- raw output
- secrets
- API keys
- provider raw payload (full request/response bodies)
- full internal traces (internal reasoning chain, tool internals beyond existing metadata)
- `run_id` / `trace_id` — **unless separately authorized by PM in a later milestone**

All exclusions are also enumerated in `MWT-4B-export-privacy-checklist.md` and enforced by `MWT-4B-export-test-plan.md` (negative leak tests).

---

## Scope Control Summary

| Dimension | v0 Position |
|---|---|
| Location | Frontend only |
| Signature | None (unsigned) |
| Raw content | Excluded |
| Attestation | None |
| Policy/approval | None |
| Backend service | None |
| Durable store | None |
| Identity model | Existing task_id only; no run_id/trace_id |
