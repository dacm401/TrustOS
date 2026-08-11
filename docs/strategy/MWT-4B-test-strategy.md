# MWT-4B Test Strategy

> **Status**: READINESS_ONLY ✅ (implementation NOT authorized)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream B
> **Companion**: `MWT-4B-acceptance-criteria.md`, `MWT-4B-non-goals-and-boundaries.md`

## 0. Purpose

Define the test approach for MWT-4B before implementation, mirroring the sealed-flow
validation discipline (deterministic, fixture-based, privacy-negative, non-zero exit).

## 1. Test layers

| Layer | Type | Approach | Mirrors |
|-------|------|----------|---------|
| Pure deterministic | regression | Fixture of N sealed events → assert bundle fields + manifest hash stable across runs | MWT-4A Regression (57/0) |
| Smoke | assembly | Build a known task bundle, assert event count + no dropped events | MWT-3B1 Smoke (8/8+1SKIP) |
| Privacy negative | assertion | Scan artifact text for raw prompt/output/provider strings; fail if found | privacy guard in MWT-3B1 |
| Frontend | build/typecheck | `npm run validate` sections 1–2 | existing |
| Backend | typecheck | `npm run validate` section 7 (if backend touched) | existing |
| Artifact validation | script | `scripts/mwt4b/run-export-validation.mts` (created at impl time) | `scripts/mwt4a/*` pattern |

## 2. Determinism rule

Export must be byte-stable for identical input. Use sorted event order + canonical JSON
(serialized field order fixed) so the manifest hash is reproducible. This is a hard AC
(AC-F4) and a regression assertion.

## 3. Privacy negative test (mandatory)

```text
Given a fixture containing events with raw_content_included=false
When the export artifact is built
Then the artifact string MUST NOT contain any raw prompt/output/args substring
And the test FAILS (non-zero exit) if it does
```

This guard enforces the non-goals firewall automatically.

## 4. Integration into `npm run validate`

When implementation is authorized, add two sections to `scripts/trst/run-validation.mts`:

| # | Section | Command |
|---|---------|---------|
| 8 | MWT-4B Smoke | `npx tsx scripts/mwt4b/run-smoke.mts` |
| 9 | MWT-4B Regression | `npx tsx scripts/mwt4b/run-regression.mts` |

The aggregator's non-zero-exit-on-failure rule keeps MWT-4B inside the same gate.

## 5. What is NOT a test target

- ❌ Live Gateway runtime (kept non-gating, per validated governance).
- ❌ Reviewer UI click-through (no frontend render framework yet — see risk R9).
- ❌ Signing crypto internals beyond hash-manifest verification (unless G3 approves more).

## 6. Test-strategy acceptance

- [ ] Determinism asserted.
- [ ] Privacy negative test present and failing-closed.
- [ ] New sections integrated into `npm run validate`.
- [ ] Existing 7 sections remain green.

## 7. Validation implications

Documentation only. No `npm run validate` change until implementation authorized and
`scripts/mwt4b/*` exist.
