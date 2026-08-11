# MWT-4B Export Privacy Checklist

> **Status**: DRAFT — DOCUMENTATION_ONLY ✅
> Use this checklist at implementation time and in review. Companion: `MWT-4B-export-test-plan.md` (negative leak tests enforce these).

---

## Privacy Exclusion Checklist

- [ ] no raw prompt
- [ ] no raw output
- [ ] no provider raw payload
- [ ] no API key
- [ ] no secret
- [ ] no hidden chain-of-thought
- [ ] no full internal trace
- [ ] no run_id / trace_id
- [ ] no approval status
- [ ] no policy decision beyond existing explicit allow/deny/unknown counts
- [ ] no identity / signature claim
- [ ] no system-of-record claim

---

## Verification Method

Each unchecked-failure condition is enforced by an automated negative test in `MWT-4B-export-test-plan.md` (sections 3, 4, 5, 6, 8). At implementation review, every box above must be green and backed by a passing test.

## Hard Boundaries (from frozen architecture)

- Hash-only event model preserved (TRST-0.3: no raw content in events).
- Export is a projection, not a new data source.
- `run_id` / `trace_id` remain DEFERRED unless PM separately authorizes.
