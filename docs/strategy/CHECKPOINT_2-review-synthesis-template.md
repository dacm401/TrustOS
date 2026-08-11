# CHECKPOINT_2 Review Synthesis Template

> **Status**: DOCUMENTATION_ONLY ✅ — template for future synthesis (not yet populated).
> **Used when**: real reviewer responses arrive (external human action, PM-owned).
> **Last updated**: 2026-08-10

---

## How to Use

1. Copy this template into `CHECKPOINT_2-review-synthesis.md`.
2. Fill one `## Reviewer <RID>` block per respondent (R1 Security / R2 Privacy / R3 Product / R4 Backend / R5 Compliance).
3. Complete `## Decision Matrix Rollup` from `CHECKPOINT_2-review-decision-matrix.md`.
4. State `## Greenlight Recommendation` — do NOT self-approve; only recommend.

---

## Reviewer R<ID> — <Role>

- **Responded**: <date>
- **Overall stance**: Approve / Approve-with-notes / Block / Abstain
- **Key points**:
  -
- **Concerns**:
  -
- **Required fixes before MWT-4B greenlight**:
  -
- **Residual risk accepted by reviewer?**: Yes / No / N-A

## Cross-Reviewer Themes

- Recurring concern:
- Conflicting view:
- Consensus:

## Decision Matrix Rollup

| Criterion | R1 | R2 | R3 | R4 | R5 | Aggregate |
|---|---|---|---|---|---|---|
| Export scope acceptable | | | | | | |
| Privacy exclusions sufficient | | | | | | |
| Unsigned label acceptable | | | | | | |
| No backend service acceptable | | | | | | |
| No attestation acceptable | | | | | | |

## Greenlight Recommendation

- Minimum reviewers (R1+R2+R3) no-BLOCK: <Yes/No>
- PM residual-risk acceptance needed: <Yes/No/NA>
- **Recommendation to PM**: `APPROVE_MWT-4B_IMPLEMENTATION` / `HOLD` / `HOLD_WITH_FIXES`
- Agent note: agent does NOT issue the approval; PM does.

## Anti-Fabrication Guard

- Every quoted reviewer point MUST trace to `CHECKPOINT_2-reviewer-response-intake-log.md`.
- If no real response logged, this template stays EMPTY. Agent must not invent content.
