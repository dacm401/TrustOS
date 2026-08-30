# 执行计划：P0 助手回复落库 + 备份/恢复

> **状态**：✅ **已执行完成**（2026-08-30）
> 两项任务均已实现、验证并提交。下文的「检查清单」全部勾选完成。
>
> 执行中发现的真实 bug（已修复并加回归测试）：
> **checksum 跨进程不一致** —— pg 返回 Date，`canonicalize` 将其视为空对象，
> 导致导出的快照无法恢复（跨进程必失败，单进程测试抓不到）。
> 修复方式是在 `computeChecksum` 内部做 JSON 规范化（修复根因而非调用点）。
> **基线**：`feature/trst-3-private-beta-readiness` @ `4b66c40`
> **目标**：补齐主权数据的两个底线缺口
> **原则**：每步可验证、可回滚；改动不阻塞对话主流程

---

## 0. 为什么要做这两项

| 项 | 缺口 | 后果 |
|---|---|---|
| **助手回复未落库** | 主权数据只有「问」没有「答」 | 对话记录不完整；蒸馏/回放只能用半截数据；「越来越懂你」缺一半素材 |
| **无备份/恢复** | 主权数据单点存放 | 一次磁盘故障 = 全部积累归零 |

> 特别强调第二项：我们刚把「数据主权」定为产品核心，
> 但**没有备份的主权不是主权**——机器故障即全失。

---

## 1. 现状勘察结论（执行前已完成）

### 1.1 助手回复的全部出口（已定位）

| 出口 | 位置 | 路径 |
|---|---|---|
| A | `chat.ts:991` | 非流式，null decision 降级：`reply: llmNativeResult.message` |
| B | `chat.ts:1082` | 非流式，delegation 但 archive 创建失败：`content: ...` |
| C | `chat.ts:1091` | **非流式主出口**：`content: llmNativeResult.message` |
| D | `chat.ts:647` | **流式/SSE**：`normalizedEvent.type === "result"` 时内容完整 |
| E | `chat.ts:142` | 权限响应：`content: permResult.reply`（非模型回复，暂不落库） |

**关键结论**：
- 委托（慢模型）结果**也走 SSE 的 result 事件**（`/chat-result` 轮询已废弃），
  故 D 覆盖委托场景，**无需在 slow-worker-loop 单独落库**。
- 因此只需覆盖 **A/B/C/D 四处**，其中 A/B/C 都是 `llmNativeResult.message`。

### 1.2 已有可复用设施

| 设施 | 位置 | 用途 |
|---|---|---|
| `ConversationTurnRepo.record()` | `src/db/repositories/conversation-turn.ts` | 落库，含密钥过滤 |
| `recordAsync()` | 同上 | 异步不阻塞 |
| `nextTurnIndex()` | 同上 | 追加序号 |
| `content_hash` | 表字段 | **可用于去重** |
| `hashContent()` | 同上 | SHA-256 |

---

## 2. 任务一：助手回复落库

### 2.1 实现步骤

**Step 1.1 — 新增落库 helper**

文件：`src/db/repositories/conversation-turn.ts`

新增导出函数（与 `record` 同级）：

```ts
/**
 * Persist an assistant reply, pairing it with the user turn that produced it.
 * turnIndex is computed from the session so Q/A stay adjacent.
 */
async recordAssistant(input: {
  sessionId: string; userId: string; content: string;
}): Promise<{ stored: boolean; reason?: string }>
```

要点：
- 复用 `containsSecret()` —— 密钥同样**永不落库**
- 空内容直接跳过（`reason: "empty_content"`）
- 内部调用 `nextTurnIndex(sessionId)` 取得序号
- 返回简化的 `{stored, reason}`（调用方不关心 id）

**Step 1.2 — 非流式路径接线（A/B/C）**

文件：`src/api/chat.ts`

在 `llmNativeResult` 就绪后、各 return 之前，统一落库。
因 A/B/C 三处返回值都源自同一变量，**在 991 之前插入一次即可覆盖三者**：

插入位置：`// S92P-HF2: 防御 null decision` 之前（约 985 行）

```ts
// ── Sovereign: persist the assistant reply (completes the Q/A pair) ──
if (process.env.TRUSTOS_SOVEREIGN_STORE !== "0") {
  const replyText = (llmNativeResult?.message ?? "").trim();
  if (replyText) {
    void ConversationTurnRepo.recordAssistant({
      sessionId: sessionId as string, userId, content: replyText,
    });
  }
}
```

⚠️ 注意：必须放在 **981 行的 `if (!llmNativeResult) return` 之后**，
否则 `llmNativeResult` 可能为 null。

**Step 1.3 — 流式路径接线（D）**

文件：`src/api/chat.ts`，约 647 行 `if (normalizedEvent.type === "result")` 分支内

在 `buildWorkerResultEnvelope({ content: normalizedEvent.stream ?? "", ... })` 之后插入：

```ts
// Sovereign: the streaming result is complete here → persist it once.
if (process.env.TRUSTOS_SOVEREIGN_STORE !== "0") {
  const streamed = (normalizedEvent.stream ?? "").trim();
  if (streamed) {
    void ConversationTurnRepo.recordAssistant({
      sessionId: sessionId as string, userId, content: streamed,
    });
  }
}
```

**Step 1.4 — 去重保护（防止 A/B/C 与 D 重复写）**

在 `recordAssistant` 内做：先查该 session 最近一条 assistant turn 的 `content_hash`，
若与本次相同则跳过（`reason: "duplicate"`）。
这样即使路径重叠也不会产生重复记录。

### 2.2 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 非流式对话后，`conversation_turns` 有 `role='assistant'` 记录 | SQL 查询 |
| 2 | 流式对话（委托任务）后同样有 assistant 记录 | SQL 查询 |
| 3 | Q/A 相邻：`turn_index` 连续 | SQL 查询 |
| 4 | 密钥内容仍不落库 | 单测（复用 `verify-archive-replay` 的思路） |
| 5 | 落库失败不影响对话返回 | 手动验证 + 代码审查（fire-and-forget） |
| 6 | 无重复记录 | 同一问题连续问两次，查重生效 |

### 2.3 验证脚本

新增 `scripts/verify-assistant-persist.mts`，覆盖：
- `recordAssistant` 的密钥过滤
- 空内容跳过
- 去重逻辑（同内容连续两次 → 第二次 skipped）
- 无 DB 时优雅降级

---

## 3. 任务二：备份 / 恢复

### 3.1 设计要点

- **快照范围**：`conversation_turns` + `memory_entries`（主权数据核心）
- **格式**：自描述 JSON，含 schema 版本 + 校验和，向后兼容
- **加密**：可选，口令派生（scrypt）+ AES-256-GCM
  （与 Phase 2 归档包共用同一密钥派生方案）
- **默认不加密**用于日常备份，**归档时才强制加密**
  （Phase 2 再落地；本次提供能力，不强制）

### 3.2 实现步骤

**Step 2.1 — 快照模块**

新建 `src/services/sovereign/backup.ts`：

```ts
export const SNAPSHOT_SCHEMA = "trustos-sovereign-snapshot/v1";

export interface Snapshot {
  schema: string;
  created_at: string;
  user_id: string;
  counts: { conversation_turns: number; memory_entries: number };
  checksum: string;          // SHA-256 over canonical JSON of data
  encrypted: boolean;
  /** Plain JSON when unencrypted; base64 ciphertext when encrypted. */
  data: unknown;
}

export async function createSnapshot(
  userId: string,
  opts?: { passphrase?: string }
): Promise<Snapshot>

export async function restoreSnapshot(
  snapshot: Snapshot,
  opts?: { passphrase?: string; dryRun?: boolean }
): Promise<{ restored: { conversation_turns: number; memory_entries: number }; skipped: number }>
```

要点：
- `checksum` 用于完整性校验（导入时验证，不匹配则拒绝）
- 恢复采用 **upsert**（按主键冲突更新），避免重复导入产生副本
- `dryRun` 模式只报告会做什么，不写库
- 加密失败或口令错误 → 明确报错，不静默降级

**Step 2.2 — CLI 入口**

新建 `scripts/sovereign-backup.mts`，加入 `package.json`：

```json
"backup:create": "npx tsx scripts/sovereign-backup.mts create",
"backup:restore": "npx tsx scripts/sovereign-backup.mts restore"
```

用法：
```bash
# 导出（明文）
npm run backup:create -- --out backup.json
# 导出（加密）
npm run backup:create -- --out backup.enc --encrypt
# 导入（先 dry-run 看看会恢复什么）
npm run backup:restore -- --in backup.json --dry-run
# 真正导入
npm run backup:restore -- --in backup.json
```

**Step 2.3 — 验证脚本**

新增 `scripts/verify-sovereign-backup.mts`，纯逻辑测试（不依赖 DB）：
- 快照 schema 版本正确
- checksum 计算与校验一致
- 篡改数据后 checksum 校验失败
- 加密 → 解密往返一致
- 口令错误 → 明确失败（不静默）
- dryRun 不写库

### 3.3 验收标准

| # | 标准 | 验证方式 |
|---|---|---|
| 1 | 能导出快照文件 | CLI 执行成功 |
| 2 | 校验和能检测篡改 | 单测 |
| 3 | 加密往返一致 | 单测 |
| 4 | dry-run 不写库 | 单测 |
| 5 | 导出→导入数据一致 | 端到端（导出后清空测试表再导入） |
| 6 | 口令错误明确报错 | 单测 |

---

## 4. 执行顺序

```
1. recordAssistant helper           (独立，可单独验证)
   ↓
2. 非流式接线 A/B/C                 (依赖 1)
   ↓
3. 流式接线 D                       (依赖 1)
   ↓
4. verify-assistant-persist         (验证 1-3)
   ↓
5. backup.ts 快照模块               (独立)
   ↓
6. sovereign-backup CLI             (依赖 5)
   ↓
7. verify-sovereign-backup          (验证 5-6)
   ↓
8. 全量 verify:trust + tsc          (回归)
   ↓
9. 提交 + 尝试推送
```

---

## 5. 风险与回滚

| 风险 | 影响 | 缓解 | 回滚 |
|---|---|---|---|
| 落库阻塞对话 | 高 | 全程 `void` + 内部 try/catch，失败只记日志 | 删除调用点 |
| 重复落库 | 中 | content_hash 去重 | 无（幂等） |
| 密钥被写入 | 高 | 复用 `containsSecret()`，命中即丢弃 | 无（已防） |
| 备份恢复覆盖现有数据 | 中 | 默认 `dryRun` 提示；恢复用 upsert | 从 git/旧备份恢复 |
| 加密口令丢失 | 高 | 与归档包一致：**无后门**，UX 明确告知 | 不可恢复（设计如此） |

---

## 6. 不做的事（明确边界）

- ❌ 不做定时自动备份（本次只提供手动 CLI；定时任务后续再说）
- ❌ 不做增量备份（全量快照，数据量小时足够）
- ❌ 不做云同步（违背"数据不出本机"定位）
- ❌ 不强制加密备份（加密留给 Phase 2 归档场景）
- ❌ 权限响应（出口 E）不落库——它不是模型回复

---

## 7. 执行检查清单（防遗忘）

**任务一**
- [ ] `conversation-turn.ts` 新增 `recordAssistant`
- [ ] 复用 `containsSecret()` 过滤密钥
- [ ] 空内容跳过
- [ ] content_hash 去重
- [ ] `chat.ts:985` 附近插入非流式落库（**必须在 981 的 null 检查之后**）
- [ ] `chat.ts:647` result 分支插入流式落库
- [ ] 新增 `scripts/verify-assistant-persist.mts`
- [ ] 端到端：非流式 + 流式各验证一次
- [ ] SQL 确认 assistant 记录存在且 turn_index 连续

**任务二**
- [ ] 新建 `src/services/sovereign/backup.ts`
- [ ] 快照 schema + checksum
- [ ] 加密/解密（scrypt + AES-256-GCM）
- [ ] 恢复用 upsert，支持 dryRun
- [ ] 新建 `scripts/sovereign-backup.mts` CLI
- [ ] `package.json` 加 backup:create / backup:restore
- [ ] 新增 `scripts/verify-sovereign-backup.mts`
- [ ] 端到端：导出 → 校验 → 导入

**收尾**
- [ ] `npm run verify:trust` 全绿
- [ ] 前后端 `tsc --noEmit` 通过
- [ ] 更新 `CURRENT-STATUS.md`
- [ ] 提交（commit message 用 `-F` 文件方式，避免中文解析问题）
- [ ] 尝试 `git push`（网络不稳定，失败则记录待重试）
- [ ] 清理临时文件（诊断脚本、commit message 文件）
