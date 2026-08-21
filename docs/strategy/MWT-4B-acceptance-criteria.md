# MWT-4B Acceptance Criteria

> **Status**: IMPLEMENTED ✅ (all AC met; Boss authorized self-seal 2026-08-21, reviewer-feedback gate waived)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream B
> **Companion**: `MWT-4B-implementation-readiness-packet.md`, `MWT-4B-test-strategy.md`

## 0. Purpose

Draft acceptance criteria for MWT-4B (evidence export / signing) so that when
implementation is authorized, "done" is unambiguous. These are NOT final until PM
approves G1–G5 in the readiness packet.

## 1. Functional criteria

- [ ] AC-F1: Reviewer can generate an export artifact from a task's sealed events.
- [ ] AC-F2: Artifact contains exactly the fields exposed by MWT-4A projection (no invented fields).
- [ ] AC-F3: Artifact includes a hash manifest (per-event `event_hash` + a bundle manifest hash).
- [ ] AC-F4: Export is reproducible — same input events → byte-stable bundle (deterministic).
- [ ] AC-F5: If signing approved (G3), artifact carries a verifiable signature; verification guide exists.

## 2. Privacy criteria

- [ ] AC-P1: No raw prompt, raw tool args, raw output, or provider payload in the artifact.
- [ ] AC-P2: `privacy_flags` preserved as-is from source events (no expansion).
- [ ] AC-P3: Privacy negative test fails the build if any raw-content string is detected.

## 3. Auditability criteria

- [ ] AC-A1: Every event in the artifact is verifiable against its `event_hash`.
- [ ] AC-A2: Bundle manifest hash covers the full artifact (tamper-evident).
- [ ] AC-A3: No event is silently dropped; artifact event count == source event count.

## 4. UX criteria

- [ ] AC-U1: Export action is discoverable from `TaskEvidenceView` (or approved surface).
- [ ] AC-U2: Reviewer can copy or download the artifact without leaving the evidence view.
- [ ] AC-U3: On failure, a clear non-technical message is shown (no stack trace / no secret leak).

## 5. Validation criteria

- [ ] AC-V1: `npm run validate` stays 7/7 (existing sections unaffected).
- [ ] AC-V2: New `MWT-4B Smoke` + `MWT-4B Regression` sections added and green.
- [ ] AC-V3: Frontend build + typecheck pass; backend typecheck pass (if backend touched).

## 6. No-regression criteria

- [ ] AC-N1: MWT-4A Regression stays 57/0.
- [ ] AC-N2: MWT-3B1 Regression stays 24/0.
- [ ] AC-N3: No change to `aggregateTaskEvidence` purity or `sealEvent` envelope.
- [ ] AC-N4: No silent Gateway behavior change; no new event types introduced.

## 7. Out-of-scope (not acceptance-covered)

- ❌ Approval workflow (MWT-5)
- ❌ Authenticated identity (MWT-4E)
- ❌ Policy engine / enforcement
- ❌ `run_id` / `trace_id` introduction

## 8. Validation implications

Documentation only. No `npm run validate` impact until implementation authorized.
