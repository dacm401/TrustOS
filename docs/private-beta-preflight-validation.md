# TrustOS Private Beta — Preflight Validation

```text
Version: v1.1 (Doc Fix Batch DF2/DF3)
Date: 2026-08-04
Purpose: Validate the reviewer experience before releasing to reviewers
Baseline: TRST-3 MVP CLOSED (commit 667a978 + TRST-3 changes)
```

---

## Validation Commands

### P1 — Gateway Startup

```bash
npx tsx --env-file=.env scripts/trst1/start-gateway.ts
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| Gateway starts without error | ✅ | | | |
| Prints "TrustOS Gateway — Private Beta" | ✅ | | | |
| Prints "Mode: Shadow (dry-run control only)" | ✅ | | | |
| Prints "Evidence: Privacy-safe, hash-based verification only" | ✅ | | | |
| Listens on configured port | HTTP 200 on /health | | | |

---

### P2 — Health Check

```bash
curl http://localhost:8787/health
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| HTTP 200 | ✅ | | | |
| Returns health status field | status-like field present | | | |

---

### P3 — Fresh Non-Streaming Model Call

```bash
curl -s -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-TrustOS-Agent-Id: preflight-test" \
  -d '{"model":"<any-model>","messages":[{"role":"user","content":"Preflight validation test."}],"stream":false}'
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| HTTP 200 | ✅ | | | |
| X-TrustOS-Trace-Id header present | ✅ | | | |
| Valid LLM response body | ✅ | | | |
| Response not empty | ✅ | | | |

---

### P4 — Event Hash Presence (Fresh Events)

```bash
tail -1 .trustos/events.jsonl | node -e "process.stdin.on('data',d=>{const e=JSON.parse(d);console.log('event_hash:',!!e.event_hash,'input_hash:',!!e.input_hash,'output_hash:',!!e.output_hash)})"
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| event_hash present | true | | | |
| input_hash present | true | | | |
| output_hash present (fresh non-streaming) | true | | | |
| event_hash is 64-char hex | SHA256 length | | | |
| output_hash is 64-char hex | SHA256 length | | | |

---

### P5 — Privacy Safety (No Raw Content in Events)

```bash
tail -1 .trustos/events.jsonl | node -e "process.stdin.on('data',d=>{const e=JSON.parse(d);console.log('raw_content_included:',e.raw_content_included===false?'false (PASS)':'MISSING OR TRUE (FAIL)')})"
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| raw_content_included is false | false | | | |
| No full prompt text in event | absent | | | |
| No full model output in event | absent | | | |

---

### P6 — Private Beta Smoke (TRST-3)

```bash
npm run trst3:smoke
```

或:

```bash
node scripts/trst3/run-private-beta-smoke.mjs
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| Overall result | ≥ 20 PASS, 0 FAIL | | | |
| output_hash coverage (fresh non-streaming) | 100% | | | |
| Evidence privacy-safe | confirmed | | | |
| Control dry-run mode | confirmed | | | |

> **关于 output_hash 覆盖率**：`output_hash coverage 100%` 仅适用于 **本轮 walkthrough 生成的 fresh successful non-streaming 事件**。TRST-2C 之前创建的历史事件可能缺少 `output_hash` — TrustOS 现在诚实地将其检测为证据完整性信号（而非静默忽略），因此在事件总数中可能出现 <100% 的覆盖率。这不代表产品缺陷，而是对历史事件的诚实标记。

### Smoke Results — Non-Technical Summary

如果 smoke test 通过（PASS），以非技术语言解释为：

| # | 含义 | 通俗解释 |
|:---|:---|:---|
| 1 | Gateway 正常运行 | 系统在运行 ✅ |
| 2 | 成功观测 AI 调用 | TrustOS 能捕获到真实的 AI 请求 ✅ |
| 3 | 事件含完整数字指纹 | 创建了 trace_id + event_hash + input_hash + output_hash ✅ |
| 4 | 新事件输出哈希覆盖 100% | 新生成的事件有完整哈希证据 ✅ |
| 5 | 证据不含原始对话内容 | 隐私安全 ✅ |
| 6 | 控制保持 dry-run 模式 | 系统只观察，不拦截 ✅ |

---

### P7 — Multi-Event Trace Demo

```bash
npm run trst3:trace-demo
```

或:

```bash
node scripts/trst3/run-multi-event-trace-demo.mjs
```

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| Overall result | 10/10 PASS | | | |
| Multiple events share same trace_id | confirmed | | | |
| All events have event_hash | confirmed | | | |
| All events have input_hash | confirmed | | | |
| All events have output_hash | confirmed | | | |

---

### P8 — Reviewer Handoff Doc Review

Manual review of `docs/private-beta-reviewer-handoff.md`:

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| Dry-run clearly explained | Yes | | | |
| Evidence privacy-safe clearly stated | Yes | | | |
| No "enforcement" claim | absent | | | |
| No "authenticated identity" claim | absent | | | |
| No "legal compliance record" claim | absent | | | |
| No "tamper-proof" claim | absent | | | |
| Walkthrough steps complete | Yes | | | |
| Limitations referenced | Yes | | | |

---

### P9 — Limitations Document Review

Manual review of `docs/private-beta-limitations.md`:

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| Supports list present and accurate | Yes | | | |
| Does-not-provide list complete | Yes | | | |
| Dry-run explanation present | Yes | | | |
| Evidence explanation present | Yes | | | |
| Forbidden terminology table present | Yes | | | |

---

### P10 — Overclaim Scan (All Docs)

Grep across all TrustOS docs for forbidden claims:

| Forbidden Pattern | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| "blocks unsafe requests" | absent | | | |
| "enforces policy" | absent | | | |
| "authenticated agent identity" | absent (outside negation) | | | |
| "tamper-proof evidence" | absent | | | |
| "notarized audit trail" | absent | | | |
| "legal compliance record" | absent (outside negation) | | | |
| "production-grade gateway" | absent | | | |
| "enterprise-ready RBAC" | absent | | | |

---

### P11 — Dependency Audit

| Check | Expected | Actual | Pass/Fail | Notes |
|---|---|---|---|---|
| package.json changes since TRST-3 | 0 added, 0 removed | | | |
| No new npm packages | None | | | |

---

## Preflight Summary

| Phase | Pass | Fail | Skip | Notes |
|---|---|---|---|---|
| P1 — Gateway Startup | | | | |
| P2 — Health Check | | | | |
| P3 — Model Call | | | | |
| P4 — Hash Presence | | | | |
| P5 — Privacy Safety | | | | |
| P6 — Smoke (TRST-3) | | | | |
| P7 — Trace Demo | | | | |
| P8 — Handoff Doc Review | | | | |
| P9 — Limitations Doc Review | | | | |
| P10 — Overclaim Scan | | | | |
| P11 — Dependency Audit | | | | |
| **Total** | | | | |

---

## Preflight Status

```text
[ ] PREFLIGHT_NOT_RUN
[ ] PREFLIGHT_PASS — All P1-P11 pass
[ ] PREFLIGHT_PASS_WITH_NOTES — Non-blocking issues noted
[ ] PREFLIGHT_FAIL — Blocker found, do NOT proceed to reviewer sessions
[ ] PREFLIGHT_ENV_UNAVAILABLE — Cannot run in current environment
```

---

## Environment Note

如果当前环境无法运行 P1–P7（无 LLM API key、无 Node.js 等），在此说明：

> (填写环境限制说明)

在此情况下，P8–P10 仍可执行，但 reviewer session 必须在验证环境完成后再进行。

---

> **Status**: Preflight Validation Template — v1.1 (2026-08-04, DF2/DF3 applied)  
> **Note**: P1–P7 需要在有 LLM API key 的环境中运行。如果不可用，标注 `NOT_RUN_ENV_UNAVAILABLE`。
