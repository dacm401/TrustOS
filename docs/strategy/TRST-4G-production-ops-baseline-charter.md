# TRST-4G — Production Ops Baseline (v0 Charter)

**Status**: SEALED ✅ (agent self-seal 2026-08-20, PM review waived by Boss)
**Date**: 2026-08-20
**Owner**: Agent (long-running)
**Boss directive**: 2026-08-19 un-defer 4E/4G; 2026-08-20 "可以开 4E/4G, push 以后再说"

---

## 1. Purpose

Establish a Private-Beta-grade operational baseline so the gateway can be run, monitored,
and diagnosed by an operator without ad-hoc scripts. This is the "can we keep it alive
and know when it breaks" layer — distinct from governance enforcement (4F).

## 2. Scope (v0 — Private Beta)

### In scope (already implemented, converged here)
- **Health probe** (`src/api/health.ts`, H1): `/health` → status / services / stats.
- **Observability** (`src/api/observability.ts`, S94P): `/v1/observability/summary`,
  `/errors` — request volume, success rate, latency, cost, token usage.
- **Metrics export** (`src/api/metrics.ts`): Prometheus `/metrics` + `/metrics/json`.
- **Runtime guards** (`src/middleware/`): `cost-cap`, `quota`, `rate-limit`.
- **v0 convergence deliverable**: `src/ops/readiness.ts` — a single `readinessCheck()`
  that aggregates health + key config validation + event-store accessibility into one
  boot-time self-check, so the Private Beta operator gets a go/no-go signal at startup.
  Zero new dependency; reuses existing health/metrics internals.

### Out of scope (guardrails — carry from R6)
- No multi-tenant ops / billing / SSO.
- No external APM / tracing SaaS (Datadog, etc.).
- No Kubernetes / container orchestration manifests.
- No alerting pipeline (email/Slack/PagerDuty) — log-only for v0.

## 3. Acceptance Criteria (v0)

| AC | Description | Status |
|----|-------------|--------|
| 4G-AC1 | `/health` returns structured status + service breakdown | ✅ (H1) |
| 4G-AC2 | `/v1/observability/summary` returns success rate + cost + latency | ✅ (S94P) |
| 4G-AC3 | `/metrics` Prometheus export works | ✅ |
| 4G-AC4 | `readinessCheck()` aggregates health + config + event-store | ✅ (v0 convergence) |
| 4G-AC5 | No new dependency; no schema change | ✅ |
| 4G-AC6 | tsc clean; ops test passes | ✅ |

## 4. Design Notes

- `readinessCheck()` is additive: it does NOT replace `/health`, it adds a startup
  gate the launcher can call before accepting traffic.
- Event-store accessibility check reuses `getStorePath()` + a non-throwing read attempt.
- Config validation: warns (does not fail) on missing optional keys; fails only on
  missing required identity/env that would break enforcement (e.g. DLP on but classifier
  empty — already guarded in 4F).

## 5. Risk

- R4G-1: observability queries hit live PG; a slow DB can block the probe.
  Mitigation: all stats queries degrade gracefully (null on error), per H1 pattern.
- R4G-2: metrics endpoint is public (no identity middleware).
  Mitigation: acceptable for Private Beta (operator-only network); promote behind auth
  in TRST-5 if exposed beyond trusted boundary.
