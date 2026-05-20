# Sprint 70P: Real DB SSR Proof V0

**Sprint:** 70P — Real DB SSR Proof V0
**Baseline:** `1c97146` (S69P CLOSED)
**Date:** 2026-05-20
**Status:** IN PROGRESS

---

## 1. Baseline

| **Repo** | **Commit** | **Status** |
|---|---|---:|
| Desktop | `1c97146` | ✅ |
| WorkBuddy | `1c97146` | ✅ |
| origin/master | `1c97146` | ✅ |

---

## 2. Goal

S69P 在无 DB 环境中证明了 SSR pipeline 的 graceful degradation 路径（mock DB → `checkDbAvailability` = false → `[]`）。

S70P 的目标是补全真实 DB 可用时的 SSR proof：

```
checkDbAvailability() = true → probe 成功
retrieveMemoriesHybrid() → 真实 memories（或空）
SSR /api/chat → qualityRouting.patchQuality 仍然可见
```

**S70P 原则：** 不改 quality routing 语义，只补真实基础设施路径 proof。

---

## 3. Design Decision

### D1: 区分 S69P vs S70P 测试路径

| 测试套件 | DB 类型 | 配置文件 | 说明 |
|---|---|---|---|
| S69P SSR E2E | Mock DB（pg mock） | `vitest.s69p.config.ts` | 无 Docker 依赖 |
| **S70P SSR E2E** | **Real Docker Postgres** | **`vitest.s70p.config.ts`** | **需 Docker running** |

### D2: Docker Postgres 生命周期管理

**测试前：** 启动 `docker-compose up postgres -d`（只起 postgres，不起 backend/frontend/minio 等）
**测试后：** `docker-compose down`（停止 postgres 容器）

若 Docker 不可用：S70P SSR E2E 测试 skip，报告明确说明 `Docker unavailable — S70P real-db tests skipped`。

### D3: 测试数据隔离

使用 `smartrouter_test` 数据库（而非 `smartrouter`），通过 `DATABASE_URL` 环境变量切换：

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/smartrouter_test
```

**Postgres image 自带初始化脚本**（`schema.sql`），`smartrouter_test` 在第一次连接时自动创建表结构。

测试数据由测试代码在 `beforeAll` 中 seed 到 `memory_entries` 表。

### D4: S70P E2E Case

| Case | 验证点 | 预期 |
|---|---|---|
| D1 | Docker available，postgres healthy | container running |
| D2 | `checkDbAvailability()` 返回 true（TTL 缓存内第二次调用 < 50ms） | true，< 50ms |
| D3 | `retrieveMemoriesHybrid()` 返回真实结果（ seeded data） | MemoryEntry[] 非空 |
| D4 | SSR `/api/chat` HTTP 200 | 200 |
| D5 | SSR SSE done event 含 `qualityRouting.patchQuality` | patchQuality 字段存在 |
| D6 | SSR pipeline 不 hang，< 15s | < 15s |

---

## 4. Files to Change

| **File** | **Change** |
|---|---|
| `S70P-SPRINT-PLAN.md` | 新建：本文件 |
| `scripts/start-db.cjs` | 新建：Docker postgres 启动脚本 |
| `scripts/stop-db.cjs` | 新建：Docker postgres 停止脚本 |
| `vitest.s70p.config.ts` | 新建：real DB SSR E2E 配置（无 pg mock） |
| `tests/services/verifier/quality-router-s70p-real-db-e2e.test.ts` | 新建：真实 DB SSR proof |
| `tests/services/verifier/quality-router-s70p-setup.ts` | 新建：beforeAll seed data |
| `skills/trustos-test/scripts/run-tests.cjs` | 更新：支持 `real-db` / `all` 模式 |

---

## 5. Ledger Schema

无新增 ledger 字段。S70P 是测试基础设施 proof，不是功能开发。

---

## 6. Expected Test Results

| **Test Suite** | **Command** | **Expected** |
|---|---|---:|
| `quality-router.test.ts` | `npx vitest run` | 24/24 ✅ |
| `artifact-verifier.test.ts` | `npx vitest run` | 23/23 ✅ |
| `quality-router-s68p-e2e.test.ts` | `npx vitest run` | 8/8 ✅ |
| `quality-router-s69p-ssr-e2e.test.ts` | `npx vitest run --config vitest.s69p.config.ts` | 7/7 ✅ |
| `quality-router-s70p-real-db-e2e.test.ts` | `npx vitest run --config vitest.s70p.config.ts` | **D1–D6 ✅/SKIP** |
| **Total** | | **62–68/N ✅** |

> **注意：** S70P SSR E2E 在 Docker 不可用时 skip（不 fail），但整体验收以可运行的 case 为准。

---

## 7. PM Sign-off Checklist

- [ ] Docker Postgres 可用性检测 + 启动/停止脚本就绪
- [ ] S70P vitest config 不 mock pg，连接真实 DB
- [ ] D1–D6 E2E case runtime proof 完成（Docker 可用时）
- [ ] S69P SSR E2E 7/7 仍然 PASS（regression guard）
- [ ] S68P E2E 8/8 仍然 PASS（regression guard）
- [ ] 单元测试 47/47 仍然 PASS（regression guard）
- [ ] 三端同步完成
- [ ] PM 签字验收
