# MWT-4B Export Release Checklist

> **Status**: DOCUMENTATION_ONLY ✅ — release gate (pre-seal).
> **Companion**: `MWT-4B-export-qa-checklist.md`, `MWT-4B-export-rollback-plan.md`, `MWT-4B-implementation-plan-draft.md`.
> **Last updated**: 2026-08-10

---

## Pre-Release Gates

### Authorization
- [ ] `APPROVE_MWT-4B_IMPLEMENTATION` issued by PM.
- [ ] Reviewer synthesis complete (or PM accepted residual risk).
- [ ] Min R1+R2+R3 no-BLOCK (or PM written override).

### Code
- [ ] Only frontend files changed (no backend/Gateway/SQLite/schema).
- [ ] `buildExportPayload` pure, 0 network calls.
- [ ] UI mount in `TaskEvidenceView.tsx` only.
- [ ] No export auto-fires; user-initiated only.

### Privacy & Trust
- [ ] Field allowlist enforced (allowlist doc).
- [ ] Exclusion rules E1–E9 all tested.
- [ ] Unsigned label + warning banner + copy pack verbatim.
- [ ] No run_id/trace_id anywhere.

### Validation
- [ ] Frontend TSC 0 new errors.
- [ ] Frontend Build PASS.
- [ ] MWT-4A smoke 26/0/0.
- [ ] MWT-3B1 smoke 8/8+1SKIP.
- [ ] New MWT-4B unit + negative + red-team tests PASS.

### Docs
- [ ] `MWT-4B-implementation-plan-draft.md` updated with actual files.
- [ ] Execution log updated to MWT-4B SEALED (post-PM seal).
- [ ] Release notes appended.

## Release Definition

MWT-4B is RELEASED only after PM issues explicit SEAL. Agent may prepare the SEAL record but not self-seal.

## Post-Release Watch

- Monitor for any export misread as attestation (user reports).
- If misuse observed, reinforce W5 / consider follow-up doc (no code change without new auth).
