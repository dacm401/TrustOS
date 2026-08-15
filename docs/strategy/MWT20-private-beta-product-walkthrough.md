# TrustOS — Private Beta Product Walkthrough v1 (Manager Workspace / Manager Loop)

```text
Version:    v1.0 (MWT-20 deliverable)
Date:       2026-08-15
Baseline:   MWT-13..MWT-19 ACCEPTED (capability READY)
Maturity:   Private Beta Candidate — READY_WITH_ENV_BLOCKERS (NOT full READY)
Upstream:   Companion to docs/private-beta-walkthrough.md (gateway startup)
```

---

## 0. Honest readiness statement (read first)

This walkthrough is a **product walkthrough / beta handoff document** for the
**Manager Workspace** surface delivered across MWT-13 through MWT-19.

It is:
- ✅ a usable, deterministic, local demonstration of the Manager Loop v0 product path;
- ✅ an honest description of what each step can and cannot do.

It is **NOT**:
- ❌ a live environment execution of the real worker runtime;
- ❌ external Private Beta reviewer feedback;
- ❌ a claim of full Private Beta READY;
- ❌ real `[LIV]` DB / gateway evidence.

```text
Global Private Beta readiness:
  READY_WITH_ENV_BLOCKERS  ⚠️
  NOT full READY

Still missing (operator-only, not fabricated by agent):
  - MWT-12 live operator run (real worker execution against live gateway/DB)
  - real [LIV] DB / gateway evidence
  - external reviewer session evidence

Internal Manager review (MWT-19) ≠ external beta reviewer feedback.
Local deterministic harness output (MWT-18) ≠ real-world completion proof.
```

---

## 1. What is the Manager Loop v0?

The Manager Workspace is now a connected product surface, not just a UI seam.
A private beta operator can walk the full loop:

```text
Conversation
  → Memory Context references        (MWT-15)
  → Trust Evidence references        (MWT-16)
  → Worker Delegation Contract       (MWT-17)
  → Controlled execution attempt     (MWT-18)
  → Internal review history          (MWT-19)
```

Every step is **auditable, ownership-scoped, and explicitly labeled** for what
it is and is not.

---

## 2. Step-by-step user path

> Route reference: `/manager` (ManagerWorkspace). All actions are scoped to the
> authenticated operator (`X-User-Id`). No cross-user leakage.

### Step 1 — Create or select a ManagerConversation (MWT-13/14)
- Open the Manager surface; create a new conversation or select an existing one.
- The conversation is the anchor for all downstream references, contracts, attempts,
  and reviews.
- Backend wiring (MWT-13) + controller/UI surface (MWT-14) keep the conversation
  as the atomic unit of manager context.

### Step 2 — Attach or view Memory Context references (MWT-15)
- View referenced Memory items from the conversation context bridge.
- These are **references by ID**, not copies of raw memory content.
- Safe by design: Memory Governance is not bypassed; no raw memory payload is
  expanded into the Manager surface.

### Step 3 — Attach or view Trust Evidence references (MWT-16)
- View referenced Trust Evidence items (hash-based, privacy-safe).
- References by ID; no raw evidence content is duplicated into the Manager surface.
- Honest framing: this is **evidence referencing**, not live enforcement.

### Step 4 — Create a Worker Delegation Contract (MWT-17)
- Define a contract: objective, intended worker, input summary, constraints,
  expected output.
- Status lifecycle: `draft → ready_for_review → approved | rejected | superseded`.
- Initially `draft`; it **cannot** spawn execution until explicitly `approved`.

### Step 5 — Review the contract (internal Manager review, MWT-19)
- Record an internal review decision on the contract:
  - `approve` / `reject` / `request_changes`
- The review is an **additive audit record** (`manager_review_records`); it does
  **not** auto-transition contract status in this v0 scope and does **not** claim
  external reviewer validation.
- UI wording: "内部经理评审 · 非 beta 评审证据".

### Step 6 — Approve, then create a controlled execution attempt (MWT-18)
- Only an `approved` contract can create a controlled execution attempt.
- Execution mode options: `deterministic_local` | `dry_run` | `manual_placeholder`.
- The harness runs a **local deterministic executor seam**:
  - `deterministic_local` → "local harness output, not live evidence; no external side effects"
  - `dry_run` → "[dry_run] No real execution"
- No external tool, gateway, network, scheduling, or autonomous loop is invoked.
- Result is explicitly **non-live** and **not a Private Beta READY proof**.

### Step 7 — Review the execution attempt result (MWT-19)
- Record an internal review decision on the attempt:
  - `accept_result` / `reject_result` / `request_rerun`
- Again additive/auditable; does **not** rewrite the attempt result (failures are
  not hidden).

### Step 8 — Show review history and audit context (MWT-19)
- The Review Panel lists all review records for the conversation, in time order,
  showing: timestamp, decision, target type, target id, and the safe reason text.
- This is the operator-facing audit trail for the Manager Loop.

---

## 3. Distinctions the walkthrough makes explicit

| Concept | What it is | What it is NOT |
|---|---|---|
| Memory/Trust refs (MWT-15/16) | ID references to context/evidence | raw content copies, live enforcement |
| Delegation Contract (MWT-17) | approved intent to delegate | autonomous execution |
| Execution attempt (MWT-18) | local deterministic harness output | real worker runtime, live completion proof |
| Manager review (MWT-19) | internal audit record | external beta reviewer feedback, READY proof |
| Capability readiness | MWT-13~19 features work | global Private Beta READY |

---

## 4. Capability summary (MWT-13 ~ MWT-19)

| Milestone | Capability | Status |
|---|---|---|
| MWT-13 | ManagerConversation backend foundation | READY ✅ |
| MWT-14 | Controller + UI surface | READY ✅ |
| MWT-15 | Memory Context references | READY ✅ |
| MWT-16 | Trust Evidence references | READY ✅ |
| MWT-17 | Worker Delegation Contract | READY ✅ |
| MWT-18 | Controlled Worker Execution Harness | READY ✅ |
| MWT-19 | Manager Review / Approve Loop | READY ✅ |

```text
Cumulative assertions (MWT-13~19): 117
beta:check: 48/0  (global verdict: READY_WITH_ENV_BLOCKERS)
```

---

## 5. Known limits and operator-only tasks

**Known limits (by design, MWT-13~19):**
- No real worker runtime execution; MWT-18 is a controlled local harness.
- No autonomous policy enforcement; MWT-19 is an internal review loop, not governance.
- No external reviewer workflow; internal review ≠ beta reviewer evidence.
- No streaming / enforcement / backend assessment API (future TRST-4 charters).

**Operator-only tasks before full Private Beta READY:**
1. Run **MWT-12 live operator run** against the live gateway/DB to produce real
   `[LIV]` evidence.
2. Supply **real `[LIV]` DB / gateway evidence** for provenance verification.
3. Recruit and run **external Private Beta reviewer sessions**; collect real
   reviewer feedback (separate from internal Manager review).
4. Reconcile internal Manager review records with external reviewer evidence
   (do not conflate the two).

---

## 6. How to run the deterministic validation (no live services)

All Manager Loop capabilities are covered by deterministic, zero-DB tests:

```bash
# MWT-18 controlled harness (regression)
npx tsx scripts/trst/mwt18-execution-harness.test.mts   # 20/20 PASS

# MWT-19 manager review loop
npx tsx scripts/trst/mwt19-manager-review-loop.test.mts  # 17/17 PASS

# Type checks
npx tsc --noEmit                                        # backend EXIT=0
cd frontend && npx tsc --noEmit                         # frontend EXIT=0

# Beta readiness check
npx tsx scripts/trst/run-private-beta-check.mts         # 48/0
```

No live LLM, gateway, or database is required to exercise these paths.

---

## 7. Screenshot / live-run policy

This document uses **route references and step descriptions only**. It does **not**
contain invented screenshots, reviewer quotes, telemetry, production results, or
live-run evidence. Real walkthrough screenshots are an operator task once a live
environment is available.

---

## 8. Source of truth

- Manager Workspace UI: `frontend/src/components/manager-workspace/ManagerWorkspace.tsx`
- API routes: `src/api/manager-conversations.ts`
- Services: `src/services/manager/{conversation,delegation-contract,execution-attempt,manager-review}-service.ts`
- Migrations: `src/db/migrations/029..031_*.sql`
- Execution log: `docs/strategy/TRST-execution-log.md`
- Gateway walkthrough (companion): `docs/private-beta-walkthrough.md`
