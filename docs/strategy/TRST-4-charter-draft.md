# TRST-4 Charter Draft (Planning Only — No Implementation Authorized)

```text
Status:        DRAFT (planning baseline, NOT implementation)
Date:          2026-08-15
Author:        Agent (autonomous, Boss-approved)
Upstream:      Manager Loop v0 SEALED at a3d34c2 (MWT-13~20 ACCEPTED)
Baseline gate: READY_WITH_ENV_BLOCKERS (global Private Beta NOT full READY)
```

---

## 0. Honest framing

This is a **charter draft only**. No code is written, no migration is added, no
service is changed by this document. It exists so the Boss can decide, after
real `[LIV]` evidence review, whether and in what order TRST-4 work should start.

It does NOT claim:
- ❌ that MWT-12 live run is done
- ❌ that `[LIV]` evidence exists
- ❌ that global Private Beta is READY
- ❌ that any TRST-4 work is authorized to implement

---

## 1. Context: what MWT-13~20 delivered (the floor TRST-4 builds on)

Manager Loop v0 is a connected, auditable, ownership-scoped product surface:

```text
Conversation (MWT-13/14)
  → Memory Context references (MWT-15, ID-only, no raw payload)
  → Trust Evidence references (MWT-16, ID-only, no raw payload)
  → Worker Delegation Contract (MWT-17, non-executing intent)
  → Controlled local execution attempt (MWT-18, deterministic_local/dry_run only)
  → Internal Manager review history (MWT-19, additive audit, no state mutation)
```

Known hard limits carried into TRST-4 scoping:
- No real worker runtime execution (MWT-18 is local harness only)
- No streaming
- No durable evidence store (events in `.trustos/events.jsonl`, not a service)
- No backend assessment API (review is stored, not evaluated by a service)
- No authenticated identity beyond `X-User-Id` header
- No policy enforcement (review ≠ governance)

---

## 2. Candidate charters (7 directions, priority-ordered)

Priority principle (frozen from TRST-3 post-mortem):
**evidence/reporting first → identity/policy → enforcement last.**

| # | Charter | Why now | Depends on | Risk if skipped |
|---|---|---|---|---|
| 4A | Evidence Report UX | Closes the "reviewer can verify output_hash" gap; highest demonstrated value, lowest risk | MWT-16 refs | Reviewer cannot act on evidence we already collect |
| 4B | Streaming Support | Real worker runtime needs streaming; unblocks live execution realism | 4A, live gateway | MWT-18 stays non-live forever |
| 4C | Durable Evidence Store | Move `.trustos/events.jsonl` to a real store; tamper-evidence at service level | 4A | Evidence lost on disk wipe; no queryability |
| 4D | Backend Assessment API | Turn internal review into an evaluable service (risk/control/evidence scoring) | 4A, 4C | Review stays manual/non-actionable |
| 4E | Authenticated Identity | Replace `X-User-Id` header trust with real auth/session | none (foundation) | Multi-user trust boundary unsound |
| 4F | Policy Enforcement | Real allow/deny control (not just "observe") | 4D, 4E | Product stays observe-only |
| 4G | Production Ops | Deploy/monitor/alert for the above | 4A–4F | No operational readiness |

Recommended sequencing (NOT a commitment, a proposal):
`4E (foundation) → 4A → 4C → 4D → 4B → 4F → 4G`

Rationale: identity is a foundation; evidence/reporting is the fastest
trust-winning win; enforcement is explicitly last (matches frozen principle).

---

## 3. Scope guardrails (carry from TRST-3)

- No premature productionization (gateway is v1 entry, not infra)
- No raw content expansion into Manager surface
- No Trust Spine semantic/hashing changes
- No Memory Governance bypass
- Migrations additive/reversible only
- No fake live/reviewer evidence

---

## 4. Decision gates (for Boss)

TRST-4 implementation should NOT start until:
1. MWT-12 live run executed in a real `[LIV]` environment (operator/Boss)
2. Real `[LIV]` DB/gateway evidence captured and verified
3. External reviewer session completed and feedback classified
4. Boss decides promotion: READY_WITH_ENV_BLOCKERS → full READY (or not)

This draft is the planning input to that decision. It becomes an
**authorized implementation charter** only by explicit Boss directive
(e.g. `APPROVE_TRST-4_MVP_IMPLEMENTATION` with a chosen subset of 4A–4G).

---

## 5. Open questions for Boss

- Which TRST-4 charters are in-scope for v1? (proposal: 4E + 4A first)
- Is MWT-12 live run to be executed by agent (requires PostgreSQL install +
  Gateway startup restore) or by Boss on a separate environment?
- Does full READY require external reviewer evidence, or is `[LIV]` + Boss
  sign-off sufficient for this project's private scope?

---

## 6. Source of truth

- Manager Loop v0 baseline: `a3d34c2`
- Execution log: `docs/strategy/TRST-execution-log.md`
- Walkthrough: `docs/strategy/MWT20-private-beta-product-walkthrough.md`
- Readiness verdict: `READY_WITH_ENV_BLOCKERS` (until real `[LIV]` evidence)
