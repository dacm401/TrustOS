# Reviewer Session 001 — Template

> Copy this file to `session-001-<role>.md` per real reviewer session.
> Sanitize all personal data. Report env presence only.

```markdown
## Reviewer Feedback — Session 001

### 1. Reviewer role
- Role: (auditor | ML engineer | PM | security | other)
- (do not record real name/handle unless approved)

### 2. Environment
- Machine: (local | shared demo)
- Browser: (Chrome | other)
- Live env supplied: (yes / no)   <-- presence only, never the value
- Beta verdict observed: (READY_WITH_ENV_BLOCKERS / READY)

### 3. Validation result
- npm run validate: (PASS / FAIL / not run)
- npm run beta:check: (PASS / FAIL / not run)
- browser harness: (PASS / ENV_BLOCKED / not run)
- live activation check: (PASS / ENV_BLOCKED / not run)

### 4. UI feedback
- Audit UI:
- Memory Governance UI:

### 5. Trust / audit feedback
- Is the audit trail understandable?
- Can you verify an artifact without raw content?

### 6. Memory governance feedback
- Do control signals surface correctly?

### 7. Blockers encountered
- (list, distinguishing ENV_BLOCKED vs real FAIL)

### 8. Severity
- (none | low | medium | high | critical)

### 9. Recommendation
- (continue | fix before beta | reject)
- Notes:
```

> Never paste secret values (API keys, DATABASE_URL) into this file.
