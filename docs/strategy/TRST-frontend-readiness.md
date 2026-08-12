# MWT-7B — Frontend Build & Runtime Readiness

**Milestone:** MWT-7B Frontend Build & Runtime Readiness v0
**Status:** IMPLEMENTED ✅ (2026-08-12)
**Branch:** `feature/trst-3-private-beta-readiness`

## Goal
Diagnose and improve frontend build/runtime readiness so the Audit and Memory UI
surfaces are deployable or clearly environment-classified. Answer:
- frontend typecheck — PASS?
- frontend build — PASS? If not, code error or environment?
- sandbox webpack/node scheme issue — avoidable / clearly diagnosed?
- Audit / Memory pages — reachable in the runtime surface?

## Root-Cause Finding (the real fix)
The prior `Frontend Build` ENV_BLOCKED was NOT a sandbox-only symptom. The frontend
import chain reached `node:crypto`:

```
frontend/src/app/page.tsx
  → MemoryGovernanceSurface
    → __fixtures__/memory-governance.ts
      → src/types/memory-governance.ts
        → src/services/mwt6/memory-governance.ts   (imports node:crypto)
```

webpack statically analyzes the `node:crypto` specifier (even a lazy `require`) and
fails the client bundle with `UnhandledSchemeError: Reading from "node:crypto" is
not handled by plugins`.

**Safe fix (no dependency change, no redesign):**
- Extract pure, crypto-free governance logic into
  `src/services/mwt6/memory-governance-core.ts`.
- Backend `memory-governance.ts` re-exports the core and supplies the real
  `node:crypto` SHA-256 default hash (backend path unchanged).
- Frontend `src/types/memory-governance.ts` re-exports the builder from the
  crypto-free core only. `node:crypto` no longer enters the client graph.

Result: `npx next build` → **compiled successfully** (5 static pages). The frontend
build is now a genuine PASS in this environment.

## Readiness Diagnostics Architecture
`scripts/frontend/frontend-build-diagnostics.mts` separates three concerns the old
single "Frontend Build" bucket conflated:

| Field | Source | Rule |
|-------|--------|------|
| `typecheck_status` | `npx tsc --noEmit` | TS errors ⇒ FAIL |
| `build_status` | `npx next build` | success ⇒ PASS; known node scheme ⇒ ENV_BLOCKED; unexpected error ⇒ FAIL |
| `runtime_surface_status` | static reachability | missing surface/branch ⇒ FAIL |

Plus booleans: `audit_surface_present`, `memory_surface_present`,
`audit_route_branch_present`, `memory_route_branch_present`, and a `diagnostics[]`
reason-code list.

### Build-status classifier (narrow, no catch-all)
`classifyBuildResult(stderr)`:
- empty stderr (build threw, nothing captured) ⇒ **FAIL**
- `isEnvBlockedError(stderr)` (known node-scheme / webpack-env signatures) ⇒ **ENV_BLOCKED** with `blocker` label
- anything else ⇒ **FAIL** (real compile error, never downgraded)

This is the SAME narrow classifier used by MWT-7 (`env-diagnostics.isEnvBlockedError`),
so build-status and live-step status share one honest vocabulary.

## Typecheck / Build / Runtime Semantics
- TypeScript errors = **FAIL** (never hidden, never downgraded).
- Missing component import = **FAIL**.
- Missing Audit/Memory surface = **FAIL**.
- Known sandbox webpack/node scheme = **ENV_BLOCKED** (now resolved; kept as classifier).
- Unexpected build compile error = **FAIL**.

## Audit / Memory Reachability
Verified statically (no backend/network dependency):
- `Sidebar.tsx` exposes `{ id: "audit", ... }` and `{ id: "memory", ... }`.
- `page.tsx` renders `<AuditReviewSurface/>` inside `activeNav === "audit"` and
  `<MemoryGovernanceSurface/>` inside `activeNav === "memory"`.
- `AuditReviewSurface.tsx` and `MemoryGovernanceSurface.tsx` files exist.

All four checks PASS → `runtime_surface_status = PASS`.

## Behavior Examples (covered by tests)
| # | Scenario | Status |
|---|----------|--------|
| A | typecheck pass | `typecheck_status = PASS` |
| B | known sandbox build issue | `build_status = ENV_BLOCKED` (with reason) |
| C | real TS/import failure | `FAIL` (never hidden) |
| D | Audit surface reachable | `PASS` |
| E | Memory surface reachable | `PASS` |
| F | missing route branch simulated | `FAIL` |
| G | unexpected build error | `FAIL` (no catch-all) |
| H | no backend/network dependency | `PASS` |
| I | integration w/ MWT-7 taxonomy | readiness vocab consistent |

## Files
- `scripts/frontend/frontend-build-diagnostics.mts` — readiness diagnostics + `classifyBuildResult`
- `scripts/frontend/run-frontend-readiness-smoke.mts` — 17 PASS
- `scripts/frontend/run-frontend-readiness-regression.mts` — 19 PASS
- `scripts/trst/run-validation.mts` — sections 37-38 (MWT-7B deterministic, offline)
- `src/services/mwt6/memory-governance-core.ts` — **new** crypto-free core
- `src/services/mwt6/memory-governance.ts` — backend wrapper (node:crypto SHA-256 default)
- `frontend/src/types/memory-governance.ts` — re-export points at crypto-free core

## Validation (post-fix)
- Deterministic: **38 PASS / 0 FAIL** (was 36, +2 MWT-7B)
- Live: 1 PASS (Frontend Build) / 2 ENV_BLOCKED (TRST-4H-III ×2) / 0 FAIL
- Overall: **READY_WITH_ENV_BLOCKERS**
- Frontend tsc: 0 errors. Backend tsc: 0 errors.

## Honesty Notes
- The build fix is a real code fix, not a reclassification. Before the fix the
  ENV_BLOCKED was honest; after the fix the PASS is honest.
- The 2 remaining ENV_BLOCKED are genuine DB/gateway (Postgres) unavailability in
  this sandbox, not frontend defects.
- No broad Next/webpack upgrade, no new bundler, no frontend redesign.
