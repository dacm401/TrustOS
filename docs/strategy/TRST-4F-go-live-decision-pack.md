# TRST-4F — Live Enforcement Go-Live Decision Pack

```text
Version: v0.1 (2026-08-20 competitiveness-first re-plan)
Owner: PM (gatekeeper) + Agent (bounded autonomy)
Branch: feature/trst-3-private-beta-readiness
Status: DRAFT — for PM review; C (real blocking code) requires APPROVE_TRST-4F_IMPLEMENTATION
```

---

## 0. Why this pack exists

4F (real DLP blocking) is the **highest-priority competitive differentiator** for
enterprise buyers (can TrustOS actually stop sensitive data from leaving the
domain?). The capability is already implemented behind two config switches and
ships **off by default** (dry-run). This pack gives PM a *measured* go-live path:

1. Observe dry-run divergence for a defined window.
2. Decide GO / HOLD from the divergence report.
3. Flip `live` with a one-line rollback safety net.

No silent mass-blocking: `live` mode only blocks when a deny rule matches; with
no deny rules configured, traffic still passes (fail-open). This is the honesty +
safety boundary.

---

## 1. The two switches

| Env var | Default | Effect |
|---|---|---|
| `TRUSTOS_DLP_ENABLED` | `false` | Enables pattern DLP: `buildEngine()` injects `DEFAULT_POLICY_RULES` (field-classification + keyword/pattern PII). Off = Shadow zero-friction. **Enterprise profile recommends `true` (note: config parses `=== "true"`, so write `true`, not `1`).** |
| `POLICY_ENFORCEMENT_MODE` | `dry_run` | `dry_run` = log divergence only, never block. `live` = deny decisions throw `PolicyBlockedError` and block the upstream call. |

**Blocking only happens when BOTH are true AND a deny rule matches.**
- `TRUSTOS_DLP_ENABLED=true` + `POLICY_ENFORCEMENT_MODE=live` → strictly_private → real `deny`, confidential → `ask_user`.
- Either switch off → no real blocking (safe default).

---

## 2. Rollback switch (instant revert)

4F enforcement is **config-flagged**. To roll back from live to dry-run, set one
env var and restart the gateway — no code change, no migration:

```bash
# Rollback: disable real blocking immediately
POLICY_ENFORCEMENT_MODE=dry_run   # (or unset it — default is dry_run)

# Full safety net: also disable DLP detection entirely
TRUSTOS_DLP_ENABLED=false
```

Because the default of `POLICY_ENFORCEMENT_MODE` is `dry_run`, simply **removing**
the env var reverts to shadow mode. No event is lost on rollback — past
enforcement events remain hash-chained in `events.jsonl`.

---

## 3. Dry-run divergence report (decision evidence)

Run before go-live to measure how many calls *would have* been blocked:

```bash
npx tsx scripts/trst/4f-dryrun-divergence-report.mts --since 2026-08-13 --min-divergence 2.0
```

- Reads `event_type: "policy_enforcement"` events from `.trustos/events.jsonl`.
- Counts `decision=deny` (would_block) and `decision=ask_user` (would_ask) under dry-run.
- Prints would_block rate and a **GO / HOLD** recommendation vs `--min-divergence`.
- `--json` for CI / automated gating.

**Exit code**: `0` = GO (divergence within threshold), `1` = HOLD.

---

## 4. Go-Live Checklist (PM sign-off)

- [ ] Dry-run window observed for defined period (e.g. ≥ N sessions / days).
- [ ] `4f-dryrun-divergence-report.mts` run; would_block rate ≤ threshold.
- [ ] `TRUSTOS_DLP_ENABLED=1` confirmed in target env (enterprise profile).
- [ ] `POLICY_ENFORCEMENT_MODE=live` set intentionally (not by accident).
- [ ] Rollback command (§2) documented in runbook / operator notes.
- [ ] `readinessCheck()` (4G) passes: DB + config + event-store healthy.
- [ ] Monitoring in place: count of `policy_enforcement` events with `blocked=true` is observable.
- [ ] Over-block playbook: how to tune `DEFAULT_POLICY_RULES` if false-positives spike.
- [ ] Explicit PM directive: `APPROVE_TRST-4F_IMPLEMENTATION` recorded in execution-log.
- [ ] Private Beta limitations doc updated to reflect live enforcement is now opt-in-on (done in A).

---

## 5. Guardrails retained (TRST-0.3 consensus, not cancelled)

- Shadow Mode remains the **default first-run** experience.
- No silent event loss: every block/hold is an explicit hash-chained event.
- Enforcement → Observation → Governance ordering preserved.
- No productionization creep: gateway stays non-product-grade infra.
- **raw payload never stored** (privacy baseline, enterprise buyers require this too).
- **enforcement events carry hashes + labels only** (evidence design, not a竞争力 cost).

---

## 6. C — real blocking code (DONE, 2026-08-20)

C wires live blocking end-to-end. Completed under Boss "按 ABC 顺序做" directive:

1. **4F → 4R anchor auto-merge (competitive audit chain)**: `emitEnforcementEvent`
   feeds every enforcement decision's `payload_hash` into `addEnforcementEventHash`.
   `getEnforcementAnchorRoot()` exposes a Merkle root over all blocking/allow decisions,
   so the exportable compliance bundle (`exportAnchorFile`) now includes **who was
   blocked / allowed and when** — an enterprise-grade tamper-evident audit trail.
2. **4E signer attribution fix**: when no explicit `signer` is passed, enforcement
   events fall back to `req.userId ?? "system"`, enabling real user attribution once
   the API layer forwards `userId` into the model-gateway call context.
3. **Safety preserved**: default remains `dry_run` + `dlpEnabled=false`. Live blocking
   only fires when BOTH switches are on AND an explicit deny rule matches (fail-open).
4. **Scope note**: 4F enforcement acts on **agent-internal LLM calls** (worker /
   planner / compressor via `model-gateway`), NOT the HTTP `/v1/chat/completions`
   forwarding path — consistent with gateway = observe entry point.

Validation: `evidence-anchor.test.ts` +3 merge cases (21 trust tests PASS), `tsc` 0 errors.

C is complete; flipping `live` for production still requires the §4 checklist + explicit PM go-live directive.

---

## 7. Operator Runbook (live is ON — 2026-08-20)

Covers checklist §4-4 (rollback), §4-6 (monitoring), §4-7 (over-block tuning).

### 7.1 Rollback (instant, no code change)
```bash
# Disable real blocking immediately (default is dry_run, so unset also reverts):
POLICY_ENFORCEMENT_MODE=dry_run
# Full safety net — disable DLP detection entirely:
TRUSTOS_DLP_ENABLED=false
```
Restart the gateway. Past enforcement events remain hash-chained in `events.jsonl`;
the compliance anchor keeps its history. No event loss on rollback.

### 7.2 Monitoring (what to watch)
- Count of `policy_enforcement` events with `blocked:"true"` → real blocks.
- Count of `decision:"ask_user"` → confidential holds queued for human review.
- `getEnforcementAnchorRoot()` / `getEnforcementAnchorCount()` → compliance anchor growth.
- `readinessCheck()` (4G) must stay `ready:true`; config check fails if
  `dlpEnabled && !policyEnforcementMode`.

### 7.3 Over-block playbook (false-positive spike)
If would_block rate spikes above threshold after go-live:
1. Tighten `DEFAULT_POLICY_RULES` (e.g. raise confidence threshold in `inferClassification`).
2. Or drop a specific rule id from the injected set in `buildEngine()`.
3. If urgent: rollback to `dry_run` (§7.1) while tuning — fail-open guarantees continuity.
4. Re-run `4f-dryrun-divergence-report.mts` to confirm divergence back within threshold.

### 7.4 Scope reminder
4F enforcement acts on **agent-internal LLM calls** (worker / planner / compressor
via `model-gateway`). The HTTP `/v1/chat/completions` forwarding path is NOT under
enforcement — by design, the gateway is the observe entry point. If HTTP-path
enforcement is later required, it needs a separate charter (gateway-side hook).
