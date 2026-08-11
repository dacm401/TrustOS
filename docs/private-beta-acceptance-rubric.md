# TrustOS Private Beta — Acceptance Rubric

```text
Version: v0.1
Date: 2026-08-03
Purpose: Define Round 1 acceptance criteria and decision outcomes
Baseline: TRST-3 MVP CLOSED
```

---

## Decision Outcomes

| Outcome | Meaning | PM Action |
|---|---|---|
| `PASS_PRIVATE_BETA_REVIEW_ROUND_1` | Product is ready for broader reviewer access | Approve next phase; consider TRST-4 chartering |
| `PASS_WITH_DOC_FIXES` | Product good, docs need improvement | Apply doc fixes; validate with 1–2 follow-up reviewers |
| `NEEDS_PRODUCT_FIX_CHARTER` | Product loop has blockers requiring code changes | Draft product-fix charter; scope TRST-4 |
| `BLOCKED` | Critical issue requires immediate halt | Escalate to PM; root-cause investigation |

---

## 1. PASS_PRIVATE_BETA_REVIEW_ROUND_1

### Quantitative Thresholds

| Metric | Threshold |
|---|---|
| Reviewer completion rate | ≥ 80% |
| Correct dry-run comprehension | ≥ 80% |
| Correct evidence comprehension (hashes, not raw content) | ≥ 80% |
| Average trust score | ≥ 4.0 / 5 |
| Average comprehension score | ≥ 4.0 / 5 |
| Average setup score | ≥ 3.5 / 5 |
| Average evidence usefulness score | ≥ 3.5 / 5 |

### Qualitative Conditions

- [ ] No critical overclaim confusion (reviewer does not think TrustOS blocks requests, authenticates identity, or provides legal-grade evidence)
- [ ] No privacy regression discovered
- [ ] No fresh event hash failure
- [ ] No evidence raw content leakage
- [ ] Smoke validation passes on reviewer environment
- [ ] Setup succeeds for ≥ 80% reviewers without observer intervention

### Examples

**PASS scenario**: 4/4 reviewers complete walkthrough. All understand dry-run. 3/4 trust evidence without raw content. Average trust 4.2, comprehension 4.5. One reviewer asks for streaming support — this is a feature request, not a blocker.

**PASS scenario**: 3/4 complete. One reviewer got stuck on `.env` format but completed after observer helped. Dry-run comprehension 100%. Average trust 4.0. No overclaim confusion.

---

## 2. PASS_WITH_DOC_FIXES

### Quantitative Thresholds

| Metric | Threshold |
|---|---|
| Reviewer completion rate | ≥ 60% |
| Dry-run comprehension (after explanation) | ≥ 80% |
| Evidence comprehension (after explanation) | ≥ 80% |
| Product loop functional | Yes — no code breakage |
| Privacy / security regression | None |

### Qualitative Conditions

- [ ] Product works technically — all commands succeed in reviewer environment
- [ ] Confusion stems from docs: unclear wording, missing steps, ambiguous instructions
- [ ] No product loop break: Observe → Assess → Evidence path works end-to-end
- [ ] No privacy/security regression
- [ ] Fixes are documentation-only (no code changes required)
- [ ] Fixes do not change product scope or claims

### Examples

**DOC_FIX scenario**: Reviewers cannot find the `.env` instructions because they're buried in a long doc. Reviewer says "I didn't know I needed an API key." Fix: add a prominent Setup Requirements section. Product works fine once key is configured.

**DOC_FIX scenario**: Two reviewers misunderstood "control" as enforcement. After re-reading the dry-run explanation, they understood. Fix: move dry-run explanation earlier and make it more prominent. No code change needed.

### NOT DOC_FIX

**NOT doc fix**: Reviewer sends a request with `stream=true` and gets HTTP 400 with cryptic error. Confusion is about product behavior, not documentation.

**NOT doc fix**: Evidence bundle on Dashboard shows model output text. This is a product issue — raw content appearing where it shouldn't.

---

## 3. NEEDS_PRODUCT_FIX_CHARTER

### Quantitative Thresholds

| Metric | Threshold |
|---|---|
| Reviewer failure due to product behavior | ≥ 2 reviewers |
| Product loop break | Any break detected |

### Qualitative Conditions

- [ ] Multiple reviewers cannot complete walkthrough due to product behavior (not docs)
- [ ] Reviewer cannot understand or trust evidence even after reading explanations
- [ ] Core loop (Observe → Evidence) has a code-level break
- [ ] Missing capability appears as a repeated blocker across reviewers
- [ ] Any issue that requires code changes to gateway, backend, frontend, or scripts

### Examples

**PRODUCT_FIX scenario**: All reviewers note that evidence export is cumbersome and want a download button. The copy-only UX is a real product limitation that needs a frontend change.

**PRODUCT_FIX scenario**: `output_hash` is missing on 40% of fresh events. This is a code bug, not a doc issue.

**PRODUCT_FIX scenario**: Reviewers consistently cannot understand risk assessments because risk signals are too technical. The assessment algorithm or UI needs rework.

---

## 4. BLOCKED

### Conditions

| Condition | Severity |
|---|---|
| Gateway cannot start in reviewer environment | CRITICAL |
| Fresh events fail hash validation | CRITICAL |
| Evidence contains raw content (privacy leak) | CRITICAL |
| Dry-run is actively misleading (reviewer thinks enforcement is happening) | CRITICAL |
| Serious privacy or security incident | CRITICAL |
| `output_hash` coverage on fresh events < 80% | HIGH |

### Action

- **Immediately stop** all reviewer sessions
- Escalate to PM with root cause
- Do NOT attempt code fix without `APPROVE_PRODUCT_FIX_IMPLEMENTATION`

### Examples

**BLOCKED scenario**: Gateway returns HTTP 500 on fresh install. Cannot proceed.

**BLOCKED scenario**: Evidence export shows raw model prompts in the bundle. Privacy regression confirmed.

**BLOCKED scenario**: All reviewers misunderstand dry-run and think TrustOS is actively blocking requests. The product language is fundamentally misleading.

---

## Decision Matrix

| Condition | Decision |
|---|---|
| All PASS thresholds met, no critical issues | `PASS_PRIVATE_BETA_REVIEW_ROUND_1` |
| Product works, confusion is doc-only, no privacy regressions | `PASS_WITH_DOC_FIXES` |
| Product has blockers requiring code changes | `NEEDS_PRODUCT_FIX_CHARTER` |
| Critical privacy/security/hash/startup failure | `BLOCKED` |
| Mixed: some doc, some product issues | `PASS_WITH_DOC_FIXES` + escalate product issues to TRST-4 charter |

---

## Scoring Calibration

### Trust Score (Q20)

| Score | Interpretation |
|---|---|
| 1 | "I do not trust this system at all" |
| 2 | "I have significant reservations" |
| 3 | "I somewhat trust it with caveats" |
| 4 | "I generally trust it" |
| 5 | "I fully trust it" |

### Comprehension Score (Q21)

| Score | Interpretation |
|---|---|
| 1 | "I don't understand what this does" |
| 2 | "I vaguely understand" |
| 3 | "I understand the basics" |
| 4 | "I have a good understanding" |
| 5 | "I fully understand the product and its limits" |

---

## Escalation Path

```text
BLOCKED → Immediate PM notification → Root cause investigation
NEEDS_PRODUCT_FIX_CHARTER → TRST-4 charter draft → PM approval
PASS_WITH_DOC_FIXES → Apply doc changes → 1-2 follow-up validations → PM re-approval
PASS → TRST-4 chartering consideration → PM discretion
```

---

> **Status**: Acceptance Rubric — Ready (2026-08-03)  
> **Note**: Thresholds are guidance. Final decision rests with PM based on holistic review.
