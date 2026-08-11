# MWT-4B Review Questionnaire (CHECKPOINT_2)

**Status:** DRAFT for reviewer use (2026-08-10)
**Companion docs:** `MWT-4B-export-signing-prebrief.md` (hardened), `CHECKPOINT_2-reviewer-recruitment-plan.md`
**Mode:** Documentation only — no implementation. Answers feed PM greenlight decision.

---

## Instructions for Reviewers

- Answer each question for your profile. Mark **N/A** if out of scope.
- Flag any conflict with TRST-0.3 baseline (Architecture Thesis / Threat Model / Execution Trace Charter).
- Keep answers specific enough to convert into ACs or gate conditions.
- Return to Agent; synthesis will produce a single recommended posture.

---

## Q1. What exactly is exported?

**Intent:** Define the precise artifact surface so nothing leaks by ambiguity.

- [ ] Task summary (event_count, tokens, cost, control counts)
- [ ] Event timeline (per-event `SAFE_META_KEYS` fields)
- [ ] Event hashes (`event_hash` / `input_hash` / `output_hash`)
- [ ] Bundle hash (`bundle_hash`, client-computed)
- [ ] Other (specify): ______

**Reviewer concern:** Does the listed surface match `SAFE_META_KEYS` exactly? What must be removed?

---

## Q2. Are hashes enough?

**Intent:** Confirm whether hash-only (no raw content) satisfies the reviewer/auditor need.

- [ ] Hashes alone are sufficient for Private Beta verification
- [ ] Hashes insufficient — explain gap: ______
- [ ] Hashes should be accompanied by: ______

**Reviewer concern:** A reviewer with independent event-store access can verify hashes; without
that access, can they trust the bundle at all? Is that acceptable?

---

## Q3. Does export imply attestation?

**Intent:** Prevent the bundle from being read as a server/authority endorsement.

- [ ] Export MUST be explicitly non-attestation ("client-generated, unsigned")
- [ ] Acceptable to include a "generated at <timestamp> by <user>" self-descriptor only
- [ ] Must NOT include any Gateway/Server signature or endorsement field

**Reviewer concern:** Could a recipient mistakenly believe TrustOS/Gateway endorsed the content?

---

## Q4. Should unsigned export be clearly labeled?

**Intent:** Force unambiguous labeling so unsigned status is never hidden.

- [ ] Yes — visible label "Client-generated, unsigned evidence projection" required
- [ ] Label must appear in both JSON metadata and Markdown header
- [ ] Label wording suggestion: ______

**Reviewer concern:** Is the label strong enough to survive forwarding / re-sharing?

---

## Q5. Is frontend-only export acceptable?

**Intent:** Validate the PM default (frontend-only, no backend signing service).

- [ ] Yes — reuse `GET /v1/events?task_id=` client-side data is sufficient
- [ ] No — backend participation required because: ______
- [ ] Frontend-only acceptable ONLY IF (condition): ______

**Reviewer concern:** Any integrity gap from not involving the backend at export time?

---

## Q6. What metadata is safe?

**Intent:** Ratify the allow-list beyond the baseline `SAFE_META_KEYS`.

- [ ] `SAFE_META_KEYS` is sufficient as-is
- [ ] Safe to add (justify each): ______
- [ ] `privacy_flags` may be exported as boolean summary only (never raw set)

**Reviewer concern:** Any field that looks harmless but could be re-identified or linked?

---

## Q7. What must be excluded?

**Intent:** Cement the prohibition list.

- [ ] Raw prompt / completion / tool payloads — NEVER
- [ ] `privacy_flags` raw internals — NEVER
- [ ] Any field outside `SAFE_META_KEYS` — NEVER (unless prebrief revised + PM re-auth)
- [ ] Other mandatory exclusions: ______

**Reviewer concern:** Edge cases where a "meta" field could carry raw content indirectly?

---

## Q8. What signing model is required later?

**Intent:** Scope the future signing work (out of 4B) so 4B does not pretend to solve it.

- [ ] Signing deferred until identity/key model exists (agree)
- [ ] Required signing properties when added: ______
  - signer identity source
  - key custody model
  - revocation / expiry
  - separation from data payload
- [ ] Backend signing service: required / not-required / separate charter

**Reviewer concern:** If 4B ships unsigned, does that block a clean signing upgrade later?

---

## Reviewer Sign-off Block

| Profile | Name | Qs answered | Conflicts flagged | Approve boundary? (Y/N) | Date |
|---|---|---|---|---|---|
| R1 Privacy | | | | | |
| R2 Security | | | | | |
| R3 Product | | | | | |
| R4 Backend | | | | | |
| R5 Compliance | | | | | |

Minimum to proceed to implementation brief: R1 + R2 + R3 approved, no unmitigated high-risk conflict.
