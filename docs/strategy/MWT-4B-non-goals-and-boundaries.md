# MWT-4B Non-Goals and Boundaries

> **Status**: READINESS_ONLY ✅ (implementation NOT authorized)
> **Date**: 2026-08-10
> **Program**: TRST Forward Planning & Readiness Program — Workstream B
> **Companion**: `MWT-4B-implementation-readiness-packet.md`, `MWT-4B-acceptance-criteria.md`

## 0. Purpose

Hard boundaries for MWT-4B so that "export" does not silently become "approval" or
"policy" or "productionization". This file is the scope firewall.

## 1. Explicit non-goals

- ❌ **No MWT-5 approval workflow** — export records what happened; it does not capture
  human approval decisions.
- ❌ **No policy engine** — no allow/deny rules, no policy DSL, no enforcement logic.
- ❌ **No `run_id` / `trace_id` introduction** — they may be *read* from the existing
  envelope if present, but MWT-4B must not add new ones.
- ❌ **No raw prompt/output leakage** — artifact carries hashes + metadata only, exactly
  like the sealed event store today.
- ❌ **No unreviewed schema expansion** — no new migration, no new `TrstEventType`, no
  new DB table without a separate PM schema-gate decision.
- ❌ **No silent Gateway behavior change** — Gateway continues to do exactly what it does
  today; export is a read-side consumer.

## 2. Boundary table

| Boundary | In scope | Out of scope |
|----------|----------|--------------|
| Content | sealed events → bundle | new event generation |
| Signing | hash manifest; detached sig only if G3 approved | trust-root / PKI infra |
| Identity | none required to generate | MWT-4E auth integration |
| Surface | TaskEvidenceView export action | approval UI (MWT-5) |
| Storage | in-memory / download only | durable approval table |
| Gateway | read-only consumer | runtime behavior change |

## 3. What would break this boundary (escalate to PM)

- Adding a write path that records a new event type.
- Introducing a blocking/enforcement check before export.
- Expanding `privacy_flags` or adding raw content fields.
- Any change to `event-envelope.ts` `TrstEventType` union.
- Any change to Gateway request/response handling.

## 4. Non-goals acceptance check

- [ ] Every non-goal above is restated in the implementation brief when MWT-4B starts.
- [ ] Code review verifies none of the out-of-scope items appear.
- [ ] `npm run validate` + new privacy negative test enforce the raw-content firewall.

## 5. Validation implications

Documentation only. The privacy negative test described here becomes a real gate only
when implementation is authorized.
