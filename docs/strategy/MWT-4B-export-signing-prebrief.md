# MWT-4B Prebrief — Task Evidence Export / Signing

**Status:** PREBRIEF_HARDENING_IN_PROGRESS ⚠️ (hardened for CHECKPOINT_2 review; implementation NOT authorized)
**Date:** 2026-08-10 (created) / 2026-08-10 (hardened)
**Based on:** MWT-4A SEALED ✅, ManagerWorkspace UX Polish SEALED ✅
**Hardening trigger:** CHECKPOINT_2 Reviewer Recruitment + MWT-4B Brief Hardening (PM 2026-08-10)

## 1. Purpose

MWT-4A made task evidence **viewable** (read-only projection). MWT-4B would make
it **portable**: export a tamper-evident, reviewer-verifiable bundle for a task.
This prebrief scopes the candidate work; it does NOT authorize implementation.

## 2. Candidate Scope

- Export selected task's `TaskEvidenceView` (summary + timeline) as a self-contained
  artifact (JSON + optional human-readable Markdown).
- Include existing event hashes (`event_hash` / `input_hash` / `output_hash`) so a
  reviewer can independently verify integrity against the Gateway event store.
- **No signing in 4B baseline.** Signing envelope deferred until an identity/key model exists
  (see MWT-5 / future charter). 4B export is a hash-only, unsigned projection snapshot.
- Frontend-only first: produce the artifact client-side from already-fetched events.
  No new backend endpoint required if reusing `GET /v1/events?task_id=` data.

## 3. Privacy Boundary (HARDENED)

- **No raw prompt/output content** in the exported bundle. The privacy boundary from MWT-4A
  (`SAFE_META_KEYS`) is the ONLY field surface that may be serialized.
- Exported bundle is a **projection snapshot**, not a system-of-record. It reflects what the
  frontend already holds, not the authoritative event store.
- No DLP / semantic detection is added. Minimization is achieved by field allow-list, not inspection.

## 4. Raw Content Prohibition (HARDENED)

Explicitly excluded from any MWT-4B artifact:

- ❌ `prompt` / `input_content` / `messages` raw text
- ❌ `completion` / `output_content` / `response` raw text
- ❌ `tool_input` / `tool_output` raw payloads
- ❌ Any field not present in `SAFE_META_KEYS`
- ❌ `privacy_flags` internals (export only a boolean/summary, never the raw flag set)

If a required field is not in `SAFE_META_KEYS`, the prebrief must be revised and PM re-authorized
before implementation — not silently widened.

## 5. Hash Semantics (HARDENED)

- `event_hash`, `input_hash`, `output_hash` are included **as-is** from the Gateway event.
- These hashes let a reviewer verify the bundle matches the event store **if** they have
  independent access to that store. The export itself does NOT prove store authenticity.
- Hashes are **integrity hints**, not attestations. The bundle MUST NOT claim "verified" or
  "attested" — only "hash-included, client-generated".
- Bundle-level hash (e.g. SHA-256 of the serialized artifact) is computed client-side and
  included as `bundle_hash` for convenience; it is self-describing, not externally trusted.

## 6. Export Trust Boundary (HARDENED)

- The export is explicitly labeled: **"Client-generated, unsigned evidence projection"**.
- It must NOT imply:
  - policy approval / task completion attestation
  - Gateway or server endorsement
  - system-of-record status
- A reviewer receiving the file understands it is a snapshot produced by the user's browser
  from data the user could already see — nothing more.

## 7. Signing Posture (HARDENED)

- **No signing in 4B baseline.** Unsigned frontend-only export is the PM default for Private Beta.
- Signing is deferred until an **identity/key model exists** (out of MWT-4B scope).
- **No backend signing service** in 4B unless explicitly re-authorized by a new PM charter.
- If a signature is later added, it must be clearly separable from the data and must not
  retroactively imply the 4B unsigned export was "trusted".

## 8. No Policy / Approval Coupling (HARDENED)

- Export does **not** require or imply any policy/approval gate (MWT-5 scope).
- `control_decision` from events is exported as observed data only, not as an approval verdict.
- Export must not be blocked by, or trigger, any enforcement/policy path.

## 9. Non-Goals (must not expand without new PM charter)

- ❌ No durable evidence store / new DB table.
- ❌ No policy/approval gate before export.
- ❌ No `run_id` / `trace_id` introduction.
- ❌ No raw prompt/output content in the exported bundle (privacy boundary from MWT-4A).
- ❌ No backend signing service unless separately chartered.

## 10. Open Questions for PM / Reviewers

1. Export format priority: JSON (machine-verifiable) vs Markdown (human-readable) vs both?
2. Is unsigned frontend-only export acceptable for Private Beta? (PM default: YES, labeled)
3. Where does the bundle live: browser download only, or reviewer workspace attachment?
4. Does export require an explicit reviewer confirmation step (avoid accidental leak)?
5. What metadata allow-list is safe beyond `SAFE_META_KEYS` (if any)?
6. What signing model is required later (when identity/key model exists)?

See `MWT-4B-review-questionnaire.md` for the canonical 8-question set.

## 11. Relationship to MWT-4A

- Reuses `aggregateTaskEvidence` + `fetchGatewayEventsByTask`.
- Reuses `SAFE_META_KEYS` privacy boundary — exported bundle must never contain raw fields.
- Builds on MWT-4A's `TaskEvidenceState`; adds a serialization layer only.

## 12. Proposed AC Skeleton (draft, not final)

| AC | Draft |
|---|---|
| AC1 | Export action present in `TaskEvidenceView` (frontend-only) |
| AC2 | Bundle contains summary + all correlated events (hashes only, SAFE_META_KEYS surface) |
| AC3 | No raw prompt/output in bundle (privacy boundary enforced) |
| AC4 | Bundle hash computable by reviewer independently |
| AC5 | JSON schema documented |
| AC6 | Markdown rendering matches view |
| AC7 | No backend change (frontend-only export) |
| AC8 | Bundle clearly labeled "client-generated, unsigned" |
| AC9 | Frontend build + typecheck pass |
| AC10 | No policy/approval coupling (export independent of enforcement) |

## 13. Reviewer Questions (for CHECKPOINT_2)

Directed to profiles in `CHECKPOINT_2-reviewer-recruitment-plan.md`:

- **Privacy (R1):** Is `SAFE_META_KEYS` sufficient? Any field that must be dropped?
- **Security (R2):** Are hashes adequate without signing for Private Beta? Replay/tamper exposure acceptable?
- **Product (R3):** Is the "unsigned / client-generated" label clear enough to prevent misuse?
- **Backend (R4):** Any reason frontend-only export cannot reuse `GET /v1/events?task_id=`?
- **Compliance (R5):** Does an unsigned projection satisfy audit-defensibility expectations?

## 14. Recommendation

Keep as prebrief until CHECKPOINT_2 reviewer feedback is synthesized and PM issues an explicit
greenlight via `MWT-4B-implementation-readiness-gate.md`. Do not implement before then.

## 15. Authorization State

```text
MWT-4B implementation: NOT_AUTHORIZED ❌
Only planning / prebrief hardening / reviewer coordination authorized (CHECKPOINT_2).
```
