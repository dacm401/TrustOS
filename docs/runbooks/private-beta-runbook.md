# Private Beta Runbook — TrustOS S97P

**Version**: v1.0  
**Date**: 2026-06-30  
**Phase**: Private Beta (5-10 users)  
**Baseline**: S96P-HF1 (`ac3759a`), benchmark 10/10 usable

---

## 1. Beta User Onboarding

### Pre-requisites
- User has a GitHub account (for identity reference)
- User agrees to beta terms: feedback is collected, no PII stored

### Onboarding Steps
1. Assign `userId` (e.g., `beta-001` through `beta-010`)
2. Add user to beta allowlist (manual, via config or env var in future)
3. Share access URL + brief instructions (see `docs/runbooks/beta-user-guide.md`)
4. Confirm first successful chat session

### Offboarding
- No automated offboarding in V0
- Manual: remove user from allowlist, retain data for analysis

---

## 2. Monitoring Checklist (Daily)

| Check | Method | Expected |
|-------|--------|----------|
| Server health | `GET /health` | 200, uptime > 0 |
| Recent errors | Beta Dashboard → Tasks: failed count | < 10% of total |
| Feedback ratio | Beta Dashboard → 满意率 | > 60% |
| Timeout rate | Beta Dashboard → 超时 count | 0 per day |
| Avg duration | Beta Dashboard → 平均耗时 | < 120s |
| Cost trend | Beta Dashboard → 预估成本 | Within budget |

### Weekly Review
1. Export feedback timeline from Beta Dashboard
2. Review all 👎 entries for common patterns
3. Check token/cost trend — flag if >20% week-over-week increase
4. Verify benchmark score: `node scripts/benchmarks/s95p-real-provider-benchmark.mjs` → should be >= 8/10

---

## 3. Incident Response

### Scenario A: Server Unresponsive
1. Check process: `tasklist | findstr node`
2. Restart: `npx tsx src/index.ts`
3. Verify: `GET /health`
4. Notify users via communication channel

### Scenario B: High Error Rate (>20%)
1. Check Beta Dashboard → 任务状态分布
2. Check server logs for error patterns
3. Check provider status (SiliconFlow API)
4. If provider issue: wait for recovery, notify users
5. If code issue: rollback to last known good commit, file bug

### Scenario C: User Reports Poor Quality
1. Check Beta Dashboard → 反馈时间线 for that user
2. Review specific 👎 reasons
3. Run benchmark to verify baseline quality
4. If systemic: escalate to engineering

### Scenario D: Cost Spike
1. Check Beta Dashboard → Token & 成本
2. Review delegation_logs for unusual patterns
3. If abuse: temporarily pause user
4. If legitimate: adjust cost budget

---

## 4. Known Limitations (S97P V0)

| Limitation | Impact | Mitigation |
|-----------|--------|------------|
| No automated user provisioning | Manual onboarding only | Acceptable for 5-10 users |
| No real-time alerts | Must check dashboard manually | Daily monitoring checklist |
| No A/B testing | Cannot compare model versions | Deferred to S98P |
| No per-user cost cap | Risk of cost overrun | Weekly cost review |
| Token tracking via decision_logs only | May miss some calls | Cross-check with provider dashboard |
| No session replay | Hard to debug user issues | Ask users to share screenshots |

---

## 5. Escalation Paths

| Level | Trigger | Action | Owner |
|-------|---------|--------|-------|
| L1 | Single user error | Review feedback, respond | PM |
| L2 | Multiple user errors | Check benchmark, check provider | PM + Eng |
| L3 | Server down | Restart, notify users | Eng |
| L4 | Data integrity issue | Rollback, investigate | Eng |
| L5 | Security incident | Shutdown beta, investigate | PM + Eng + Security |

---

## 6. Data Retention & Privacy

- **Feedback data**: Stored in `feedback_events` table with `raw_data` JSONB
- **PII policy**: No PII in `feedback_reason` — users instructed not to share personal info
- **Retention**: All beta data retained through beta phase; cleanup policy TBD
- **Access**: PM + Engineering only

---

## 7. Rollback Plan

If S97P changes cause regression:
1. Revert commit: `git revert ac3759a..HEAD`
2. Restart server
3. Run benchmark to confirm S96P baseline (10/10)
4. Notify users of temporary feature removal (Beta tab will disappear)
