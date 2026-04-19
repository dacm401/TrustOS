# Current Sprint

**Sprint 36 — Phase 3.0 Manager-Worker 基础设施（Phase 0）**
**Status:** ✅ Phase 0 Complete — 2026-04-19
**Commit:** `7540b99` | push 待网络恢复

---

## Task Cards

| Task Card | Description | Status | 产出 |
|-----------|-------------|--------|------|
| S36-1 | ManagerDecision 类型（types/index.ts） | ✅ Done | 完整 Phase 3.0 类型系统 |
| S36-2 | SQL migration（task_archives + task_commands + task_worker_results） | ✅ Done | `010_task_archive_phase3.sql` |
| S36-3 | TaskArchiveRepo + TaskCommandRepo + TaskWorkerResultRepo | ✅ Done | `task-archive-repo.ts` |
| S36-4 | decision-validator.ts（zod 校验 + parseAndValidate） | ✅ Done | `orchestrator/decision-validator.ts` |
| S36-5 | tsc --noEmit + vitest | ✅ Done | 172 tests 全绿 ✅ |
| S36-push | Commit `7540b99` push | ⏳ 待网络 |

---

## Phase 0 交付说明

Phase 0 不改主链路，只落基础设施。现有 Fast/Slow/L0/L1/L2/L3 路由完全不受影响。

### 新增文件

| 文件 | 说明 |
|------|------|
| `backend/src/types/index.ts` | ManagerDecision / CommandPayload / WorkerResult / SSE Phase 3 types |
| `backend/src/db/task-archive-repo.ts` | TaskArchiveRepo + TaskCommandRepo + TaskWorkerResultRepo |
| `backend/src/db/migrations/010_task_archive_phase3.sql` | task_commands + task_worker_results 建表 |
| `backend/src/orchestrator/decision-validator.ts` | zod 校验 + parseAndValidate() |

### 核心设计决策

- **zod 而非 ajv**：已安装，无新依赖
- **幂等插入**：ON CONFLICT (idempotency_key) 防重
- **旧 task_archives 表复用**：Phase 1.5 已有建表，新增字段不破坏现有逻辑
- **无 chat.ts 接入**：Phase 0 只落基础设施，Phase 1 才接主链路

### Phase 0 验证方法

```bash
# 1. 执行 migration
psql $DATABASE_URL -f backend/src/db/migrations/010_task_archive_phase3.sql

# 2. 类型校验
npx tsc --noEmit

# 3. 单元测试
npm run test  # 172 tests ✅
```

---

## Sprint 35 — ✅ Complete

**R1 测试套件全通过 + vitest NTFS 稳定化**
- Commits: `28d2475`, `b27d318`
- 单元测试：8 files / 172 tests ✅
- R1 API 测试：4 files / 35 tests ✅
- 总计：207 passed

---

## Sprint 34 — ✅ Complete

**L1 Benchmark 扩测完成。** routing-benchmark.json 扩充至 L0:20 / L1:10 / L2:36 合计 66 条。
Commit `1217f27` pushed ✅

---

## Sprint 33 — ✅ Complete

**Phase 2.0 流量分级上线完成。** 三层路由（L0/L1/L2）从内部实现正式暴露为可观测、可评测的生产级功能。
Commit `82f2703` pushed ✅

---

## Sprint 32 — ✅ Complete

**Phase 1.5 任务卡片 + Clarifying 流程 + Slow 只读优化**
- Commits: `7574415`, `e1223b3`, `51bb297`, `aff2ac5`, `eb9dbc7`, `6e29011`, `c49c88a`
- Phase 1.5 任务卡片 Schema（task_type / task_brief / state）
- Phase 1.5 Clarifying 流程（CLARIFYING_STATE + SSE clarifying 事件）
- Memory/Evidence 效果增强（intent-aware boost）
- SSE done 事件两路推送 + SSEEvent stream 字段统一

---

## 早期 Sprint

See `docs/sprint-XX-review.md`
