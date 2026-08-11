# MWT-4B Export Non-Goals

> **Status**: DRAFT — DOCUMENTATION_ONLY ✅
> Defines what MWT-4B v0 explicitly does NOT do. Companion: `MWT-4B-export-scope-spec.md`.

---

## Explicit Non-Goals

1. **Signing** — no cryptographic signature, HMAC, or certificate.
2. **Backend attestation** — no server-side verification or statement of truth.
3. **Compliance certification** — not a SOC2/ISO/regulatory artifact.
4. **Policy approval** — does not approve, allow, or block anything.
5. **Task completion certification** — does not claim the task is done or correct.
6. **Durable evidence storage** — TrustOS does not persist the export.
7. **PDF generation** — JSON (and optional copy) only; no PDF renderer.
8. **Cryptographic verification workflow** — no verify path, no key management.
9. **run_id / trace_id identity model** — excluded unless separately authorized later.
10. **Reviewer bypass** — does not replace or shortcut human reviewer outreach (CHECKPOINT_2).

---

## Why These Are Non-Goals

MWT-4B v0 is a **portable readability aid** for an already-observed task projection. Introducing signing, attestation, durability, or identity would create a new trust primitive that requires its own charter (future MWT / TRST-4 track), not a frontend-only export.

Any of these becoming goals later requires a separate PM charter + implementation authorization.
