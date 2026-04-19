# Current Sprint

**Sprint 35 — R1 测试套件全通过 + vitest NTFS 稳定化**
**Status:** ✅ Complete — 2026-04-19

---

## Task Cards

| Task Card | Description | Status |
|---|---|---|
| S35-1 | vitest.config.ts 移除 setupFiles（单元测试无需 DB setup） | ✅ Done |
| S35-2 | vitest.r1.config.ts 添加 NODE_PATH（NTFS hardlink 修复） | ✅ Done |
| S35-3 | chat-execute.test.ts Phase 2.0 全面修复（router mock / orchestrator / beforeEach） | ✅ Done |
| S35-4 | tasks.test.ts middleware 修复（c.set 替代直接属性赋值） | ✅ Done |
| S35-5 | chat.test.ts 补 getDefaultRouting mock | ✅ Done |
| S35-6 | ci.yml 换 pgvector/pgvector:pg15 镜像 | ✅ Done |
| S35-push | Commit `28d2475` pushed to origin/main | ✅ Done |

**Test Results:**
- 单元测试（vitest.config.ts）：8 files / 172 tests ✅
- R1 API 测试（vitest.r1.config.ts）：4 files / 35 tests ✅
- 总计：**207 passed**

---

## Sprint 34 Summary

**L1 Benchmark 扩测完成。** routing-benchmark.json 扩充至 L0:20 / L1:10 / L2:36 合计 66 条。
- Commit `1217f27` pushed ✅
- Benchmark CI 回归门：routing ≥ 50% / intent ≥ 70% / layer ≥ 50%（待服务器运行验证）

---

## Sprint 33 Summary

**Phase 2.0 流量分级上线完成。** 三层路由（L0/L1/L2）从内部实现正式暴露为可观测、可评测的生产级功能。

核心交付：
- `routing_layer` 字段覆盖全部 SSE 事件类型（fast_reply / clarifying / chunk / status / result / error / done）
- `/api/chat/eval/routing` 端点返回 `routing_layer`
- `inferRoutingLayer()` 逻辑覆盖 L0/L1/L2/L3 全路径
- Phase 1.5 Clarifying 流程 + Phase 1 直接回复路径零回归
- `docs/PHASE-2-ROUTING-PLAN.md` 完整架构文档

---

## Sprint 32 — Completed ✅

**Phase 1.5 任务卡片 + Clarifying 流程 + Slow 只读优化**
- Commits: `7574415`, `e1223b3`, `51bb297`, `aff2ac5`, `eb9dbc7`, `6e29011`
- Phase 1.5 任务卡片 Schema（task_type / task_brief / state）
- Phase 1.5 Clarifying 流程（CLARIFYING_STATE + SSE clarifying 事件）
- Phase 1.5 Slow 只读优化（Task Brief JSON 格式）
- Memory/Evidence 效果增强（intent-aware boost + retrieveEvidenceForContext）
- SSE done 事件两路推送 + SSEEvent stream 字段统一

---

## Sprint 07 — Completed and Closed ✅

See `docs/sprint-07-review.md`

---

## Sprint 06 — Completed and Closed ✅

See `docs/sprint-06-review.md`

---

## Sprint 05 — Completed and Closed ✅

See `docs/sprint-05-review.md`

核心交付：
- `routing_layer` 字段覆盖全部 SSE 事件类型（fast_reply / clarifying / chunk / status / result / error / done）
- `/api/chat/eval/routing` 端点返回 `routing_layer`
- `inferRoutingLayer()` 逻辑覆盖 L0/L1/L2/L3 全路径
- Phase 1.5 Clarifying 流程 + Phase 1 直接回复路径零回归
- `docs/PHASE-2-ROUTING-PLAN.md` 完整架构文档

---

## Sprint 32 — Completed ✅

**Phase 1.5 任务卡片 + Clarifying 流程 + Slow 只读优化**
- Commits: `7574415`, `e1223b3`, `51bb297`, `aff2ac5`, `eb9dbc7`, `6e29011`
- Phase 1.5 任务卡片 Schema（task_type / task_brief / state）
- Phase 1.5 Clarifying 流程（CLARIFYING_STATE + SSE clarifying 事件）
- Phase 1.5 Slow 只读优化（Task Brief JSON 格式）
- Memory/Evidence 效果增强（intent-aware boost + retrieveEvidenceForContext）
- SSE done 事件两路推送 + SSEEvent stream 字段统一

---

## Sprint 07 — Completed and Closed ✅

See `docs/sprint-07-review.md`

---

## Sprint 06 — Completed and Closed ✅

See `docs/sprint-06-review.md`

---

## Sprint 05 — Completed and Closed ✅

See `docs/sprint-05-review.md`
