# TRST-4E — Authenticated Identity (v0 Charter)

**Status**: SEALED ✅ (agent self-seal 2026-08-20, PM review waived by Boss)
**Date**: 2026-08-20
**Owner**: Agent (long-running)
**Boss directive**: 2026-08-19 un-defer 4E/4G; 2026-08-20 "可以开 4E/4G, push 以后再说"

---

## 1. Purpose

Bind every governance action (approval, enforcement decision, evidence anchor) to a
**cryptographically verifiable identity**, so a reviewer/auditor can attribute an action
to its signer — not merely a free-text `userId` string.

This closes the "who decided this" gap in the Trust product loop
(Observe → Visualize → Correlate → Assess → **Control → Prove** → Evidence Export).

## 2. Scope (v0 — Private Beta)

### In scope (already implemented, converged here)
- **Local Ed25519 identity binding** (`src/services/identity/local-identity.ts`, MWT-4E):
  - `generateIdentity`, `signBody`, `verifySignature`, `descriptorFromPublicKeyPem`.
  - No backend DB / schema / migration. No external CA/PKI. Web Crypto only.
- **Request authentication middleware** (`src/middleware/identity.ts`, Sprint 48):
  - JWT Bearer (production), X-User-Id (trusted proxy), query.user_id (dev fallback).
  - `getContextUserId(c)` uniform accessor used across all API handlers.
- **v0 convergence deliverable**: enforcement & evidence-anchor events now carry a
  `signer_identity` field (userId + optional public_key_fingerprint), so the Event
  Backbone records *who* triggered an enforcement decision / anchor export.
  Reuses `local-identity.ts` types; **does not introduce a new key store**.

### Out of scope (guardrails — carry from TRST-3 / R6)
- No global auth system / SSO / OAuth provider.
- No external identity service / CA / PKI / directory.
- No schema change to users table; identity material stays local (filesystem/env).
- No productionization of identity infra (RBAC, multi-tenant identity).

## 3. Acceptance Criteria (v0)

| AC | Description | Status |
|----|-------------|--------|
| 4E-AC1 | `local-identity.ts` Ed25519 sign/verify round-trips | ✅ (MWT-4E, 18 tests) |
| 4E-AC2 | `identityMiddleware` resolves userId from JWT / X-User-Id / dev fallback | ✅ (Sprint 48) |
| 4E-AC3 | Enforcement event includes `signer_identity` (userId + optional fingerprint) | ✅ (v0 convergence) |
| 4E-AC4 | Evidence anchor file includes `signer_identity` of exporter | ✅ (v0 convergence) |
| 4E-AC5 | No new dependency; no DB/schema change | ✅ |
| 4E-AC6 | tsc clean; trust-layer tests pass | ✅ |

## 4. Design Notes

- `signer_identity` is **attribution metadata**, not an auth gate. It does not change
  enforcement logic (which remains fail-open + opt-in DLP per 4F).
- Fingerprint is optional: populated only when the caller supplies a local identity
  descriptor. Default path (X-User-Id) records userId only — sufficient for Private Beta.
- Future (post-Private-Beta): promote `local-identity.ts` to a persistent key store +
  bind to JWT subject for end-to-end signed governance chain (TRST-5 candidate).

## 5. Risk

- R4E-1: fingerprint-only attribution without key store = not tamper-proof.
  Mitigation: R4 (user-anchored evidence) provides external tamper evidence separately.
- R4E-2: userId spoofing via X-User-Id behind untrusted proxy.
  Mitigation: production path uses JWT; dev fallback gated by `allowDevFallback`.
