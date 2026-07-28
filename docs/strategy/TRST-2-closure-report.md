# TRST-2 Six-Phase Baseline Closure Report

**Status:** `READY_FOR_PM_FINAL_CLOSE`

**Product:** TrustOS / TRST-2

**Date:** 2026-07-28

**PM:** 已 Final Accept Prove Baseline, 等待 TRST-2 整体关闭

---

## Executive Summary

TRST-2 从零构建了 TrustOS 六阶段 AI 审计基线，从 Gateway 事件捕获到 privacy-safe evidence bundle 导出，在 **14 个 accepted commits** 中实现完整闭环:

```
Observe → Visualize → Correlate → Assess → Control(dry-run) → Prove
```

- **24 个变更文件**, 跨越前端 (Dashboard), 后端 (Gateway / Worker / Chat), 数据库 (migration), 烟雾脚本
- **6 个烟雾脚本** 覆盖 health-metrics, events, trace-correlation, agent-chain, assess-signal, prove-evidence
- **零新增依赖, 零 package/lockfile 变更, .env 保持 gitignored**
- **所有验证通过**: frontend build (6/6), backend tsc (0 errors), 全部烟雾 PASS
- **隐私边界零破坏**: /events 不含 raw content, evidence bundle 仅含 hashes, forbidden-key 扫描清净

---

## Phase A — Phase-by-Phase Inventory

### 1. Observe — Gateway 事件捕获与健康可见

**Objective:** 建立 Gateway 作为 TrustOS 入口, 捕获所有 LLM 调用事件并提供 Dashboard 健康可见性。

**Delivered:**
- GatewayStatusCard 组件 (15s 轮询 localhost:8795)
- /health 端点输出 uptime_seconds, events_count, gateway_overhead_ms
- Gateway CORS 支持 Dashboard 跨域轮询
- JSONL event store 事件计数 (countEvents)
- 废弃独立 playground.html

**Key Files:**
| File | Role |
|------|------|
| `frontend/src/components/dashboard/GatewayStatusCard.tsx` | Dashboard Gateway 健康卡片 (+349) |
| `frontend/src/lib/api.ts` | fetchGatewayHealth() API 客户端 (+29) |
| `frontend/src/hooks/useQueries.ts` | useGatewayHealth() hook (+13) |
| `src/services/trst1/llm-gateway-server.ts` | Gateway HTTP 服务器 (重构 +356/-84) |
| `src/services/trst1/jsonl-event-store.ts` | countEvents() (+19) |
| `scripts/trst2/run-health-metrics-smoke.mjs` | 健康指标烟雾 (8 checks) |

**Commits:**
- `adbdcf2` — feat(trst2): surface gateway status in dashboard
- `2a91b0f` — feat(trst2): add gateway health metrics

**Validation:**
- Health metrics smoke: 8/8 PASS
- /health 样例: `{uptime_seconds:12, events_count:69, gateway_overhead_ms:null}`
- GatewayStatusCard online/offline 均正确渲染
- Frontend build: PASS

**Limitations:**
- gateway_overhead_ms 返回 null (无 metrics collector, 非阻塞)
- Gateway 无持久化存储 (JSONL 文件写入, 重启后数据保留但无索引)

---

### 2. Visualize — 事件链查看器

**Objective:** 在 Dashboard 提供 read-only 事件链查看, 使 sanitized Gateway 事件可视化。

**Delivered:**
- EventChainViewer 组件: 按 trace_id 分组, 展开/折叠, 事件详情
- /events API 端点 (Gateway 侧, 支持 ?since 参数)
- Events smoke 脚本 (隐私验证)

**Key Files:**
| File | Role |
|------|------|
| `frontend/src/components/dashboard/EventChainViewer.tsx` | 事件链查看器 (+351) |
| `frontend/src/lib/api.ts` | fetchEvents() API (+52) |
| `scripts/trst2/run-events-smoke.mjs` | 事件隐私烟雾 (266 lines) |
| `src/services/trst1/llm-gateway-server.ts` | /events 端点 (+64) |
| `src/services/trst1/jsonl-event-store.ts` | queryEvents() (+28) |

**Commits:**
- `895d495` — feat(trst2): add read-only event chain viewer

**Validation:**
- Events smoke: PASS (隐私验证, 无 raw content 泄露)
- EventChainViewer 正确分组并展示事件
- Frontend build: PASS

**Limitations:**
- 无分页 (全部事件一次性加载)
- 无搜索/过滤
- 仅支持 since 时间过滤

---

### 3. Correlate — Trace 关联与 Worker 透传

**Objective:** 建立 trace 关联能力, 使 manager /api/chat 调用与 Worker 委托任务共享同一 trace_id。

**Delivered:**
- GatewayTraceHeaders 规范 (traceId/sessionId/runId)
- /api/chat → Gateway 真实路由 (TRUSTOS_GATEWAY_URL feature-flagged)
- Worker 从 task_archives.gateway_trace_headers 恢复 trace 身份
- DB migration 025: gateway_trace_headers JSONB column
- manager vs worker agentId 区分 (消除 UNKNOWN_AGENT)
- Trace correlation smoke + agent chain validation smoke

**Key Files:**
| File | Role |
|------|------|
| `src/api/chat.ts` | /api/chat Gateway 路由 + trace header 生成 (+28) |
| `src/models/providers/openai.ts` | AsyncLocalStorage<GatewayTraceHeaders>, Gateway 客户端路由 (+128) |
| `src/models/model-gateway.ts` | Streaming client Gateway 路由 (+14) |
| `src/services/phase3/slow-worker-loop.ts` | Worker trace 恢复 + agentId 覆盖 (+32) |
| `src/services/llm-native-router.ts` | gateway_trace_headers → task_archives (+6) |
| `src/db/task-archive-repo.ts` | gateway_trace_headers 读写 (+10) |
| `src/db/schema.sql` | gateway_trace_headers JSONB column (+4) |
| `src/db/migrations/025_trst2_worker_trace_persistence.sql` | Migration 025 (+7) |
| `src/config.ts` | trustosGatewayUrl 配置 (+2) |
| `scripts/trst2/run-trace-correlation-smoke.mjs` | Trace 关联烟雾 (327 lines) |
| `scripts/trst2/run-agent-chain-validation.mjs` | Agent 链验证烟雾 (359 lines) |

**Commits:**
- `c58a1de` — feat(trst2): add trace correlation validation
- `b960d91` — feat(trst2): add agent chain correlation validation
- `4f5a026` — feat(trst2): route real caller through gateway
- `ce5021c` — feat(trst2): correlate worker calls with parent trace
- `02fbaa1` — fix(trst2): add index signature to GatewayTraceHeaders
- `24f20f5` — chore(trst2): pre-Assess hygiene - distinguish manager vs worker

**Validation:**
- Worker model_call via Gateway: PASS (carries parent trace_id)
- ≥2 events sharing same trace_id: PASS
- Trace Correlation Smoke: 19/19 PASS
- Agent Chain Validation: PASS
- Privacy: 19/19 PASS (no forbidden raw keys)
- Backend tsc: 0 errors
- Default behavior: PASS (TRUSTOS_GATEWAY_URL unset = unchanged)

**Limitations:**
- Worker trace fallback 作用于当前 execution, 未来并发 Worker 需要 AsyncLocalStorage wrapping
- User → Assistant → Worker → Tool → Worker 完整链未全部验证 (仅 manager→worker 已验证)

---

### 4. Assess — Metadata-Only 风险评估

**Objective:** 基于 sanitized 事件 metadata (不含 raw content) 推导 privacy-safe 风险信号, 并在 Dashboard 展示 per-trace risk badges。

**Delivered:**
- Risk signal taxonomy (4 categories, 18 signals):
  - Operational: HIGH_LATENCY, GATEWAY_OVERHEAD_HIGH, EVENT_FAILED, UNKNOWN_AGENT, MODEL_PROVIDER_UNKNOWN
  - Privacy: MISSING_EVENT_HASH, MISSING_INPUT_HASH, MISSING_OUTPUT_HASH, MISSING_ARGS_HASH, MISSING_RESULT_HASH
  - Trace Integrity: SINGLE_EVENT_TRACE, MISSING_TRACE_ID, MISSING_SESSION_ID, MISSING_RUN_ID, UNCORRELATED_EVENT, TIMESTAMP_DISORDER
  - Behavior: TOOL_WITHOUT_MODEL, MODEL_SUCCESS_NO_OUTPUT
- Risk levels: none / low / medium / high
- Ephemeral derived (no DB, no schema, no persistence)
- Dashboard per-trace risk badges (EventChainViewer group headers)
- Session-level aggregation

**Key Files:**
| File | Role |
|------|------|
| `frontend/src/lib/assess-utils.ts` | 评估工具: signal types, computeAssessment, RiskBadge (+212) |
| `frontend/src/components/dashboard/EventChainViewer.tsx` | RiskBadge 集成, risk 分布统计 (+127/-37) |
| `scripts/trst2/run-assess-signal-smoke.mjs` | 评估烟雾 (340→353 lines) |

**Commits:**
- `6d4f097` — feat(trst2): Assess Discovery - risk signal smoke prototype
- `0cdbd4c` — fix(trst2): harden assess signal smoke hash checks
- `fd15e1d` — feat(trst2): assess dashboard minimal surface — per-trace risk badges

**Validation:**
- Assess smoke: 12/12 PASS
- Dashboard RiskBadge 正确渲染 per-trace
- Frontend build: 6/6 PASS
- 零 raw content 参与评估

**Limitations:**
- 无风险评分加权 (仅 count-based)
- 无趋势/时间序列分析
- 信号不持久化 (无历史对比)
- 无告警阈值

---

### 5. Control — Dry-Run 控制建议

**Objective:** 基于 Assess 信号映射 dry-run control recommendation (allow/review/would_block), 在 Dashboard 展示但不执行任何运行时控制。

**Delivered:**
- ControlAction: allow / review / would_block
- computeControlRecommendation() 基于 eligible signals (privacy, trace_integrity, 仅 medium+ severity)
- ControlBadge 组件 (Dashboard EventChainViewer)
- per-trace control 分布统计

**Key Files:**
| File | Role |
|------|------|
| `frontend/src/lib/assess-utils.ts` | ControlAction, ControlRecommendation, computeControlRecommendation() (+56) |
| `frontend/src/components/dashboard/EventChainViewer.tsx` | ControlBadge 集成, control 分布 (+70/-2) |

**Commits:**
- `1ae31e7` — feat(trst2): control discovery — dry-run control recommendation UI

**Validation:**
- Control labels 正确映射: allow/review/would_block
- ControlBadge 颜色/文案正确
- 零运行时影响 (label-only)
- Frontend build: PASS

**Limitations:**
- 无 policy 配置 (硬编码信号→控制映射)
- 无审批工作流
- 无 enforcement (dry-run only, 符合设计)
- 控制建议不持久化

---

### 6. Prove — Privacy-Safe Evidence Bundle

**Objective:** 将整条链路 (events + assessment + control) 组合为 privacy-safe evidence bundle JSON, 支持 stdout 输出和 --out 文件导出。

**Delivered:**
- trstos-evidence-bundle/v0 schema
- Bundle 组成: trace metadata, events (hashes only), assessment summary, dry-run control recommendation, privacy guarantee
- 13 项自检 (递归 forbidden-key 扫描, 隐私验证)
- --trace-id 过滤 + --out 导出

**Key Files:**
| File | Role |
|------|------|
| `scripts/trst2/run-prove-evidence-smoke.mjs` | Evidence bundle 烟雾脚本 (453 lines) |

**Commits:**
- `7acc6fa` — feat(trst2): prove discovery — evidence bundle smoke script

**Validation:**
- Evidence smoke: 13/13 PASS
- --trace-id 过滤: PASS
- --out export (44 bundles): PASS
- Forbidden-key scan (44 bundles): PASS (clean)
- node --check: PASS

**Limitations:**
- 无独立 hash 验证
- 无加密签名
- 无公证 (notarization)
- 无持久审计 API
- 无 auth/RBAC

---

## Phase B — Canonical End-to-End Demo Path

**Assumptions:**
- Gateway 运行于 localhost:8795
- Backend (3001) 需要 PostgreSQL + Redis (本地环境可能不可用, 非阻塞)
- Frontend 运行于 localhost:3000
- .env 配置 TRUSTOS_GATEWAY_URL=http://localhost:8795 (local only, not committed)

**Steps:**

```text
1. Start Gateway
   npm run trst1:gateway
   → Gateway listening on :8795

2. Start backend (if available)
   npm run dev
   → Backend on :3001

3. Start frontend
   cd frontend && npm run dev
   → Dashboard on :3000

4. Send real /api/chat request
   curl -X POST http://localhost:3001/api/chat \
     -H "Content-Type: application/json" \
     -d '{"messages":[{"role":"user","content":"Hello!"}]}'
   → Backend → Gateway → LLM upstream → Gateway emits model_call event

5. Worker picks up delegated task (if applicable)
   → Worker → Gateway → additional model_call events with same trace_id

6. Verify /health
   curl http://localhost:8795/health
   → {"status":"ok","uptime_seconds":...,"events_count":>0}

7. Verify /events (privacy-safe)
   curl http://localhost:8795/events
   → Array of events, no raw content fields

8. Open Dashboard
   → GatewayStatusCard: online, shows uptime + event count
   → EventChainViewer: events grouped by trace_id
   → RiskBadge: per-trace risk level
   → ControlBadge: per-trace dry-run recommendation

9. Run assess smoke
   node scripts/trst2/run-assess-signal-smoke.mjs
   → 12/12 PASS, per-trace assessments

10. Run prove evidence smoke
    node scripts/trst2/run-prove-evidence-smoke.mjs
    → 13/13 PASS, bundles to stdout

11. Export evidence bundle
    node scripts/trst2/run-prove-evidence-smoke.mjs --out=results/evidence.json
    → 44 bundles exported to file
```

**Fallback if environment unavailable:**
- Smoke scripts 直接 fetch Gateway /events (不依赖 backend 3001)
- 如果 Gateway 无事件, smok scripts 会报告 0 events 但仍验证 schema/隐私

---

## Phase C — Validation Matrix

| # | Validation Item | Command | Expected | Last Known | Phase |
|---|---|---|---|---|---|
| 1 | Frontend build | `cd frontend && npm run build` | 6/6 static pages | PASS | All |
| 2 | Backend tsc | `npx tsc --noEmit` | 0 errors | PASS (0) | All |
| 3 | Health metrics smoke | `node scripts/trst2/run-health-metrics-smoke.mjs` | 8/8 PASS | PASS | Observe |
| 4 | Events smoke | `node scripts/trst2/run-events-smoke.mjs` | Privacy PASS | PASS | Visualize |
| 5 | Trace correlation smoke | `node scripts/trst2/run-trace-correlation-smoke.mjs` | 19/19 PASS | PASS | Correlate |
| 6 | Agent chain validation | `node scripts/trst2/run-agent-chain-validation.mjs` | PASS | PASS | Correlate |
| 7 | Assess signal smoke | `node scripts/trst2/run-assess-signal-smoke.mjs` | 12/12 PASS | PASS | Assess |
| 8 | Prove evidence smoke | `node scripts/trst2/run-prove-evidence-smoke.mjs` | 13/13 PASS | PASS | Prove |
| 9 | node --check (smoke scripts) | `node --check scripts/trst2/*.mjs` | 0 errors | PASS | All |
| 10 | /health endpoint | `curl http://localhost:8795/health` | `{"status":"ok",...}` | PASS | Observe |
| 11 | /events endpoint | `curl http://localhost:8795/events` | Array, no raw content | PASS | Visualize |
| 12 | package/lockfile unchanged | `git diff adbdcf2..7acc6fa -- package.json package-lock.json` | empty | PASS (clean) | All |
| 13 | .env not tracked | `git check-ignore .env` | `.env` (ignored) | PASS | All |

**All 13 validations: PASS. No regressions.**

---

## Phase D — Privacy & Safety Guarantees

### Guaranteed (已验证):

- ✅ `/events` 端点不暴露 raw content (prompt/response/input/output)
- ✅ Evidence bundle 仅含 event hashes, 不含 raw content
- ✅ Evidence bundle privacy guarantee: `raw_content_included: false`
- ✅ Forbidden-key 递归扫描 (prompt, response, api_key, token, secret, key, password, input, output, content, text, message, data) — 44 bundles clean
- ✅ Assess 信号仅基于 metadata (hashes, timestamps, counts, status codes)
- ✅ Control 为 dry-run label, 无运行时 enforcement
- ✅ Assessment/Control 不持久化 (ephemeral)
- ✅ 零新增 dependencies
- ✅ .env 被 .gitignore 排除, 未提交

### Not Guaranteed / Out of Scope:

- ❌ 独立 hash 验证 (无法用 event_hash 反推原始内容)
- ❌ 加密签名 (无 JWT/PKI/数字签名)
- ❌ 内容安全审核 (无 DLP)
- ❌ 运行时阻断 (dry-run only)
- ❌ Auth/RBAC (Gateway 无认证)
- ❌ 生产合规认证 (prototype 阶段)
- ❌ 审计持久化 API (evidence bundle 为一次性导出)
- ❌ 公证/第三方时间戳

---

## Phase E — Repo / Release Readiness

| Check | Status |
|-------|--------|
| Current branch | `s101t-typescript-debt-cleanup` |
| Current HEAD | `7acc6fa` |
| Staged changes | 无 (仅 webpack cache .gz, tsbuildinfo) |
| Unstaged relevant changes | 8 files modified (`package.json`, `scripts/trst1/start-gateway.ts`, `src/services/trst1/*.ts`) — **TRST-1C 残留, 非 TRST-2** |
| package.json diff | +3 npm scripts (`trst2:stream-smoke`, `trst2:mcp-lifecycle-smoke`, `trst2:health-metrics:smoke`), +`--env-file=.env` on gateway start — **未提交** |
| package-lock.json diff | 无变更 |
| .env tracked? | NO (gitignored ✅) |
| New dependencies in chain? | **ZERO** (package.json/package-lock.json untouched in 14 commits) |
| New migration? | 1: `025_trst2_worker_trace_persistence.sql` (gateway_trace_headers JSONB) |
| Unrelated residue | **大量** untracked: artifacts/, docs/, reports/, events_*.json, s9*p/s10*p smoke logs, tsc output files (~60+ files) |
| Tag candidate clean? | ⚠️ **NO** — 8 unstaged modified files + 60+ untracked artifacts |

### Blockers before tag/release:

1. **8 unstaged modified files** 归属 TRST-1C (非 TRST-2 scope) — 需 PM 决定: commit/clean/stash
2. **60+ untracked artifacts** (smoke logs, benchmark results, temp files) — 需 .gitignore 或清理
3. **分支在 s101t-typescript-debt-cleanup** — 建议合并到 master 后再 tag

### Recommendation:

```text
- 不阻塞 TRST-2 关闭: 这些 residue 是 S9xP/S10xP 遗留物, 不影响 TRST-2 baseline 完整性
- Tag 前清理: PM 下令后再执行
- 当前状态: TRST-2 commits 本身是 path-isolated 且干净的
```

---

## Phase F — Next Track Recommendation

### Primary Recommendation: **A) TRST-2 Hardening & Release Candidate**

**Rationale (matching PM preference):**

TRST-2 六阶段 baseline 已完整闭环, 但当前 repo 状态不适合直接 tag/release:
- 8 unstaged files (TRST-1C 残留)
- 60+ untracked artifacts
- 非 master 分支

Hardening scope:
```text
1. 清理 unstaged 变更 (commit or stash)
2. 清理/管理 untracked artifacts (.gitignore 或 删除)
3. 合并至 master
4. 运行完整烟雾矩阵 (6 scripts, 全部 PASS 确认)
5. 打 tag: v0.2-trst2-baseline
6. 可选: 合并 TRST-1 和 TRST-2 到统一 master 基线
```

### Secondary Options (不优先):

| Option | Description | Why Deferred |
|--------|-------------|-------------|
| B) Dashboard Evidence Export Button | 前端一键导出 evidence bundle | Feature work, 非 hardening |
| C) Control Dry-Run CI Smoke | CI 集成 dry-run control 验证 | 依赖 repo clean + CI 配置 |
| D) TRST-1C MCP Spike | MCP protocol exploration | 独立 track, 非 TRST-2 scope |
| E) Productionization Discovery | 生产化调研 | 过早, baseline 尚未 release-candidate |

### Immediate Next Task:

```text
PM Decision: "TRST-2 Hardening Start"
→ agent executes cleanup + tag + final smoke run
→ PM marks TRST-2 CLOSED
```

---

## Known Limitations

### Observe
- gateway_overhead_ms = null (无 metrics collector)
- JSONL 存储无索引, 大量事件时性能未知

### Visualize
- /events 无分页, 无搜索/过滤
- EventChainViewer 一次性加载全部事件

### Correlate
- Worker trace fallback 作用域为单次执行, 未来并发需 AsyncLocalStorage
- 完整 agent chain (user→assistant→worker→tool→worker) 未全路径验证

### Assess
- 信号无加权 (仅 count-based)
- 无历史趋势/对比
- 信号不持久化

### Control
- Policy 硬编码 (无配置)
- 无审批流
- Dry-run only (by design, not a limitation)

### Prove
- 无独立 hash 验证
- 无加密签名/公证
- 无持久审计 API
- Evidence bundle 为一次性导出 (非持续审计)

### Cross-Cutting
- Gateway 无 auth/RBAC
- 无生产 policy engine
- 无 runtime enforcement (全链路 dry-run)
- 无生产 trust score

---

## Final Continuity

```text
Observe:      ✅ CLOSED  (2 commits: adbdcf2, 2a91b0f)
Visualize:    ✅ CLOSED  (1 commit: 895d495)
Correlate:    ✅ CLOSED  (6 commits: c58a1de, b960d91, 4f5a026, ce5021c, 02fbaa1, 24f20f5)
Assess:       ✅ CLOSED  (3 commits: 6d4f097, 0cdbd4c, fd15e1d)
Control:      ✅ DRY-RUN BASELINE CLOSED  (1 commit: 1ae31e7)
Prove:        ✅ CLOSED  (1 commit: 7acc6fa)
```

---

## Accepted Commit Chain

```text
adbdcf2 — feat(trst2): surface gateway status in dashboard                  [Observe]
2a91b0f — feat(trst2): add gateway health metrics                          [Observe]
895d495 — feat(trst2): add read-only event chain viewer                    [Visualize]
c58a1de — feat(trst2): add trace correlation validation                     [Correlate]
b960d91 — feat(trst2): add agent chain correlation validation               [Correlate]
4f5a026 — feat(trst2): route real caller through gateway                    [Correlate]
ce5021c — feat(trst2): correlate worker calls with parent trace             [Correlate]
02fbaa1 — fix(trst2): add index signature to GatewayTraceHeaders            [Correlate]
24f20f5 — chore(trst2): pre-Assess hygiene - manager vs worker Gateway      [Correlate]
6d4f097 — feat(trst2): Assess Discovery - risk signal smoke prototype       [Assess]
0cdbd4c — fix(trst2): harden assess signal smoke hash checks                [Assess]
fd15e1d — feat(trst2): assess dashboard minimal surface — risk badges       [Assess]
1ae31e7 — feat(trst2): control discovery — dry-run control UI               [Control]
7acc6fa — feat(trst2): prove discovery — evidence bundle smoke script       [Prove]
```

**14 commits. 24 files. 6 phases. 0 dependencies. All validations PASS.**

---

## Report Metadata

- **Generated:** 2026-07-28
- **Author:** Agent (蟹小钳)
- **PM Status:** PROVE_BASELINE_CLOSED; awaiting TRST-2 final close
- **Next:** PM Decision → TRST-2 Hardening & Release Candidate
