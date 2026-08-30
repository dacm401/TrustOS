# 执行计划：P1 主权数据包 + 治理能力 + Evidence 持久化

> **状态**：✅ **已执行完成**（2026-08-30）
> P1 三项均已实现、端到端验证并提交。
>
> 执行中发现并修复的真实问题：
> 1. **`VALID_SOURCES` 缺少 `auto_learn`** —— 类型定义允许，但 API 白名单没有；
>    此前只因 distiller 直接写库绕过校验才「能工作」，语义不一致。
> 2. **pending 必须真正阻断注入** —— 否则「待确认」形同虚设（已在 injector 加门控）。
> 3. 注入可见用**内存环形缓冲**（限 50 条），**不落库**——避免账目表涨得比主权数据还快。
> **基线**：`feature/trst-3-private-beta-readiness` @ `d0597dd`（已推送远程）
> **前置**：PLAN-P0（助手回复落库 + 备份/恢复）已完成
> **原则**：先计划后动手；复用已有设施，不重复造轮子

---

## 0. 勘察结论（执行前已完成，避免走弯路）

| 项 | 现状 | 对计划的影响 |
|---|---|---|
| **memory 后端 API** | 已完整：`POST /`、`GET /`、`GET /governance`（MWT-6）、`GET/PUT/DELETE /:id` | **无需新建后端 CRUD**，只补治理语义 |
| **MemoryGovernanceSurface** | 132 行，**已接真实 API**（`fetchMemoryGovernance`），fixture 仅作 fallback；但**只读，无任何操作** | 工作是加「操作」而非「接数据」 |
| **backup.ts** | 已有快照 + 校验和 + scrypt/AES-256-GCM 加密 | **Archive 复用同一套加密与快照设施** |
| **evidence-bundle-service.ts** | 已能生成签名 bundle，但**按需生成、不落库** | 工作只是加持久化层 |

---

## 1. P1-1：Phase 2 主权数据包（Archive Bundle）

### 1.1 与「备份」的区别（重要，避免混淆）

| | 备份（已完成） | 主权数据包（本次） |
|---|---|---|
| 目的 | 灾难恢复 | **阶段性归档 + 长期持有 + 可迁移** |
| 加密 | 可选（默认明文，图方便） | **强制**口令加密（要带走/备份到别处） |
| 热层处理 | 不动 | **归档后原文移出热层**（设 `archive_id`） |
| 删除 | — | **永不删除**（主权资产） |
| 触发 | 手动 | 手动 + 按时间 + 按大小阈值提示 |

### 1.2 实现步骤

**Step 1.1 — 新增 `src/services/sovereign/archive.ts`**

```ts
export const ARCHIVE_SCHEMA = "trustos-sovereign-archive/v1";

/** Create an encrypted archive bundle and mark the turns as archived. */
export async function createArchiveBundle(
  userId: string,
  opts: { passphrase: string; before?: Date; limit?: number }
): Promise<ArchiveBundle>

/** Import an archive bundle back (verify → decrypt → upsert). */
export async function importArchiveBundle(
  bundle: ArchiveBundle, opts: { passphrase: string; dryRun?: boolean }
): Promise<{ restored: number; skipped: number }>

/** How many hot turns are waiting — drives the "time to archive" hint. */
export async function countArchiveable(userId: string): Promise<number>
```

要点：
- **复用** `backup.ts` 的 `computeChecksum` 与加密/解密（已修复 Date 规范化问题）
- 打包内容：`conversation_turns`（**不含** `memory_entries` —— 蒸馏物永不归档，
  见 RFC-001「小数据常驻，大数据归档」）
- 打包后调用 `ConversationTurnRepo.markArchived(ids, archiveId)` —— **只标记不删除**
- 强制口令：无口令直接报错（归档包是要带走的，明文无意义）

**Step 1.2 — CLI**

`scripts/sovereign-archive.mts`：
```bash
npm run archive:create -- --out 2026-08.enc --passphrase <pw> [--before 2026-08-01]
npm run archive:import -- --in 2026-08.enc --passphrase <pw> [--dry-run]
npm run archive:status          # 有多少热层数据待归档
```

**Step 1.3 — 验证脚本 `scripts/verify-sovereign-archive.mts`**

- 归档后 `archive_id` 被设置、**行未被删除**（关键：主权数据永不删除）
- 导入后可恢复
- 错误口令明确失败
- **`memory_entries` 不受归档影响**（蒸馏物常驻）

### 1.3 验收标准

| # | 标准 |
|---|---|
| 1 | 归档包生成且强制加密 |
| 2 | 归档后原文仍可查（只标记未删除） |
| 3 | 导入后数据恢复 |
| 4 | Memory 蒸馏物不因归档而丢失 |
| 5 | 错误口令明确报错 |

---

## 2. P1-2：治理能力

### 2.1 缺口分析

`MemoryGovernanceSurface` 已接真实数据，但**只读**。缺：

| 缺 | 说明 |
|---|---|
| 删除 | 无法移除错误记忆 |
| 编辑/降权 | 无法修正 |
| 待确认队列 | 架构要求低置信度进 pending，但 UI 无入口 |
| provenance 展示 | 看不到记忆来自哪次对话 |
| 注入可见 | 看不到本轮用了哪些记忆 |

### 2.2 实现步骤

**Step 2.1 — 后端（轻量）**

`src/api/memory.ts` 已有 `PUT/DELETE /:id`，补充：
- `POST /v1/memory/:id/confirm` —— 待确认 → 生效（提升 importance）
- `GET /v1/memory?status=pending` —— 待确认队列（复用现有 list，加 status 过滤）

**Step 2.2 — 前端**

`MemoryGovernanceSurface.tsx` 增加：
- 每条记录的操作区：**删除 / 降权 / 确认**
- provenance 展示：`rule:*` 与 `turn:*` 标签 → 显示为「来源：规则 X / 会话 Y」
- 顶部提示：待确认数量
- 操作后 `refetch` 刷新

**Step 2.3 — 注入可见（后端已有日志，补 API）**

新增 `GET /v1/memory/injections?session_id=` 返回最近注入记录。
> 需先在 `injector.ts` 记录注入日志到可查询处（当前只有 stdout）。
> 方案：写入一条内存环形缓冲（最近 N 条），供 UI 查询——**不落库**避免膨胀。

### 2.3 验收标准

| # | 标准 |
|---|---|
| 1 | 能删除一条记忆 |
| 2 | 能降权/编辑 |
| 3 | provenance 可见（规则 + 会话） |
| 4 | 待确认队列有入口 |
| 5 | 前端 tsc + build 通过 |

---

## 3. P1-3：Evidence Bundle 持久化

### 3.1 现状

`evidence-bundle-service.ts` 已能生成**签名** bundle，但按需生成、不落库。

### 3.2 实现步骤

**Step 3.1 — 新表**

migration `033_evidence_bundles.sql`：
```sql
CREATE TABLE IF NOT EXISTS evidence_bundles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(64) NOT NULL,
  trace_id VARCHAR(128),
  session_id VARCHAR(128),
  schema_version VARCHAR(64) NOT NULL,
  bundle JSONB NOT NULL,
  digest VARCHAR(128) NOT NULL,
  signed BOOLEAN NOT NULL DEFAULT false,
  chain_valid BOOLEAN,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Step 3.2 — API**

`src/api/evidence.ts` 增加：
- `POST /v1/evidence/bundle/save` —— 生成并持久化（返回 id）
- `GET /v1/evidence/bundles` —— 列表（按 user 过滤）
- `GET /v1/evidence/bundles/:id` —— 获取（供回溯）

（验证端点 `POST /v1/evidence/bundle/verify` 已有）

**Step 3.3 — 验证脚本**

- 保存后可列出、可获取
- 取回的 bundle 仍能通过签名验证
- JSONB 往返不破坏 digest（**复用 backup 修复的 Date 规范化经验**）

### 3.3 验收标准

| # | 标准 |
|---|---|
| 1 | 能保存并列出 bundle |
| 2 | 取回后签名验证仍通过 |
| 3 | 无 raw content 落库（隐私护栏不变） |

---

## 4. 执行顺序

```
P1-1 主权数据包
  1. archive.ts               (复用 backup 设施)
  2. CLI sovereign-archive    
  3. verify-sovereign-archive 
       ↓
P1-2 治理能力
  4. 后端 confirm + pending   
  5. 前端操作 + provenance    
  6. 注入可见 API             
       ↓
P1-3 Evidence 持久化
  7. migration 033            
  8. API save/list/get        
  9. 验证脚本                 
       ↓
10. 全量 verify:trust + tsc
11. 提交 + 推送
```

---

## 5. 不做的事

- ❌ 不做定时自动归档（提供 `archive:status` 提示即可，调度后续再说）
- ❌ 归档不删 `memory_entries`（蒸馏物常驻，是「越来越懂你」的核心）
- ❌ 归档不删 `conversation_turns`（**主权数据永不删除**，只标记）
- ❌ Evidence 不做自动清理（证据要能追溯）
- ❌ 不做云端同步

---

## 6. 检查清单（防遗忘）

**P1-1**
- [ ] `src/services/sovereign/archive.ts`
- [ ] 复用 `backup.ts` 的 checksum + 加密（**不重复实现**）
- [ ] 只打包 `conversation_turns`
- [ ] 打包后 `markArchived`（**只标记不删除**）
- [ ] 强制口令
- [ ] CLI：create / import / status
- [ ] `scripts/verify-sovereign-archive.mts`
- [ ] 端到端：归档 → 确认未删除 → 导入恢复

**P1-2**
- [ ] 后端 `POST /v1/memory/:id/confirm`
- [ ] `GET /v1/memory` 支持 status 过滤
- [ ] 前端删除 / 降权 / 确认操作
- [ ] provenance 展示（rule / turn 标签）
- [ ] 注入可见 API + UI
- [ ] 前端 tsc + build

**P1-3**
- [ ] migration 033 + schema.sql 同步
- [ ] `POST /v1/evidence/bundle/save`
- [ ] `GET /v1/evidence/bundles` / `/:id`
- [ ] 验证脚本

**收尾**
- [ ] `npm run verify:trust` 全绿
- [ ] 前后端 tsc
- [ ] 更新 `CURRENT-STATUS.md`
- [ ] 提交（`-F` 文件方式）
- [ ] 推送
- [ ] 清理临时文件
