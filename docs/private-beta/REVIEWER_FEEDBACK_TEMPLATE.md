# Reviewer Feedback Template — MWT-10

Copy this template per reviewer session. One block per reviewer.

```markdown
## Reviewer Feedback

### 1. Reviewer role
- Name / handle:
- Role: (auditor | ML engineer | PM | security | other)

### 2. Environment
- Machine: (local | shared demo)
- Browser: (Chrome | other)
- Live env supplied: (yes / no — TRST-4H-III live sections)
- Beta verdict observed: (READY_WITH_ENV_BLOCKERS / READY)

### 3. Validation result
- npm run validate: (PASS / FAIL / not run)
- npm run beta:check: (PASS / FAIL / not run)
- browser harness: (PASS / ENV_BLOCKED / not run)

### 4. UI feedback
- Audit UI:
- Memory Governance UI:

### 5. Trust / audit feedback
- Is the audit trail understandable?
- Can you verify an artifact without raw content?

### 6. Memory governance feedback
- Do control signals surface correctly?
- Any misleading state?

### 7. Blockers encountered
- (list, with ENV_BLOCKED vs real FAIL distinction)

### 8. Severity
- (none | low | medium | high | critical)

### 9. Recommendation
- (continue | fix before beta | reject)
- Notes:
```

> Do not paste secret values (API keys, DATABASE_URL) into this template.
> Report env presence only (e.g. "live env supplied: yes").
