# TrustOS Private Beta Round 1 — Reviewer Invite

```text
Version: v1.0
Date: 2026-08-04
Audience: Prospective reviewers (to be sent as email/Slack/message)
Status: READY_FOR_DISTRIBUTION
```

---

## Invite Template — Standard (All Paths)

---

**Subject: TrustOS Private Beta — Reviewer Invitation**

Hi [Name],

I'm inviting you to participate as a reviewer for **TrustOS**, an AI governance observation system currently in Private Beta.

### What is TrustOS?

TrustOS is a lightweight observation layer that sits between AI agents and model APIs. It records what happens during AI interactions — generating digital fingerprints (hashes) of inputs and outputs — without exposing the actual conversation content. Think of it as a **safety inspection log for AI activity**: it tells you what happened, what signals were detected, and what action would be recommended, while keeping the underlying data private.

**Key fact**: In Private Beta, TrustOS observes and records. It does **not** block, modify, or remediate AI requests.

### Why Review?

We need real reviewers to validate whether TrustOS's observation approach is:
1. **Understandable** — Can you follow what TrustOS is doing?
2. **Useful** — Would this help you govern AI activity in your domain?
3. **Honest** — Are the limitations clearly stated? No overclaiming?

### Your Role

You've been mapped to **Path [A/B/C]** based on your background:

| Path | Focus | Reviewer Profile |
|:---|:---|:---|
| **Path A** — Technical/Operator | Technical depth: run gateway, validate hashes, check dry-run | Developer, engineer, operator |
| **Path B** — Business/Governance | Governance perspective: evidence review, risk understanding, no terminal required | Business, risk, governance |
| **Path C** — Security/Privacy | Security review: hash integrity, privacy safety, architecture boundaries | Security, privacy, compliance |

**Your path: Path [A/B/C].** See detailed brief below.

### What to Expect

| Aspect | Detail |
|:---|:---|
| **Time commitment** | 30-60 minutes |
| **Terminal required?** | Path A: Yes. Paths B/C: No (observer handles terminal). |
| **Coding required?** | No. Review is about understanding, not implementation. |
| **Format** | Guided walkthrough with observer. You review, comment, score. |
| **Deliverable** | Completed feedback form + observer checklist |

### Next Steps

If you're available, I'll send a scheduling link for a 45-60 minute session. No preparation needed — everything will be explained in the session.

Thanks for considering this!

— [Sender Name]

---

## Path-Specific Briefs

### Path A — Technical / Operator Reviewer

**Your focus**: Does TrustOS work as described from a technical perspective?

You'll review:
1. Gateway startup and health check
2. Model call with trace ID — observe that events are generated
3. Hash validation — verify event_hash, input_hash, output_hash are present
4. Dry-run control — confirm no requests are blocked or modified
5. Evidence bundle — review schema, privacy safety, hash completeness
6. Trace correlation demo — observe multi-event trace with shared trace_id

**What you need**: Terminal access (observer will guide you through commands).

**Key questions we need answered**:
- Is the dry-run semantics clear and verifiable?
- Are the hashes meaningful (can you verify output_hash independently)?
- Is the trace correlation useful for understanding AI agent activity?
- What's missing from an operator/technical reviewer perspective?

---

### Path B — Business / Governance Reviewer

**Your focus**: Can a governance stakeholder understand and trust what TrustOS observes?

You'll review:
1. What TrustOS is and is not (limitations walkthrough)
2. Evidence interpretation — using the non-technical evidence guide
3. Smoke validation results — what "20 PASS / 0 FAIL" means in plain language
4. Dry-run comprehension — understanding that TrustOS observes, doesn't enforce
5. Product positioning — is it clear what TrustOS provides vs. doesn't provide?
6. Evidence bundle — can you understand what it proves without reading JSON?

**What you need**: No terminal or technical setup. Observer handles all of that.

**Key questions we need answered**:
- After the session, can you explain TrustOS to a colleague?
- Does the evidence guide make sense without technical knowledge?
- Is the dry-run limitation clearly and honestly communicated?
- Would you trust this as a governance observation tool?
- What's confusing or feels like overclaiming?

---

### Path C — Security / Privacy Reviewer

**Your focus**: Does TrustOS protect privacy and maintain evidence integrity?

You'll review:
1. Privacy safety — verify raw_content_included=false, no forbidden keys in events or evidence
2. Hash integrity — verify event_hash, input_hash, output_hash, and understand hash verification
3. Dry-run boundary — confirm no enforcement, no request blocking or modification
4. Evidence schema — review what's included vs. excluded
5. Architecture boundaries — understand agent_id as label (not identity), no RBAC, no signing
6. Limitations accuracy — check that no security claims exceed Private Beta scope

**What you need**: Terminal access for hash verification (observer can demonstrate).

**Key questions we need answered**:
- Is privacy adequately protected (no raw content in evidence)?
- Are the hash mechanisms meaningful for integrity verification?
- Are there any misleading security claims in the docs or product behavior?
- What security capabilities would be needed before production use?

---

## Scheduling Template

```text
Subject: TrustOS Review Session — [Path A/B/C]

Hi [Name],

Thanks for agreeing to review TrustOS. Let's schedule a 45-60 minute session.

Available slots (your timezone):
- [Date 1] [Time range]
- [Date 2] [Time range]
- [Date 3] [Time range]

During the session:
- You'll follow a guided walkthrough (Path [A/B/C] focus)
- No coding or setup needed on your end
- I'll handle all technical operations
- Your honest feedback is what we need — no need to be polite

Please let me know which slot works best.

— [Sender Name]
```

---

## Reviewer Profile Summary

For PM reference — recommended invitations:

| # | Profile | Path | Priority |
|:---|---:|:---|:---|
| 1 | AI product / engineering | A | High — technical validation |
| 2 | Governance / risk | B | High — governance validation |
| 3 | Security / privacy | C | High — privacy/security validation |
| 4 | Developer / operator | A | Medium — operational perspective |
| 5 | Skeptical non-builder | B | Medium — stress-test accessibility |

Minimum for PASS: 3 real reviewers (at least 1 each from 2 different paths).

---

*REVIEWER_INVITE | v1.0 | 2026-08-04 | READY_FOR_DISTRIBUTION*
