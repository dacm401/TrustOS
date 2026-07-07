# Phase 3 "Reliable Polling" — 代码审查报告

> 审查日期：2026-07-07 | 审查范围：5 个核心源文件 + 数据层 + 类型层 + 入口点 | 状态：审查完成

---

## 1. 审查范围

| 文件 | 大小 | 角色 |
|------|------|------|
| `src/services/phase3/sse-poller.ts` | 868 行 | SSE 事件轮询 + Manager Synthesis |
| `src/services/phase3/slow-worker-loop.ts` | 1361 行 | Slow Worker 后台轮询 (Cycle Runtime, Verifier, Patch) |
| `src/services/phase3/execute-worker-loop.ts` | 246 行 | Execute Worker 后台轮询 |
| `src/services/phase3/task-watchdog.ts` | 119 行 | 任务卡住检测看门狗 |
| `src/services/phase3/stream-v2.ts` | 73 行 | Thinking 状态定义 |
| `src/db/task-archive-repo.ts` | 620 行 | Archive/Command/Result 三表仓库 |
| `src/types/delegation.ts` | 568 行 | Phase 3 类型定义 |
| `src/api/chat.ts` (sse 路径) | — | SSE 连接入口 |
| `src/index.ts` (worker lifecycle) | — | Worker 启停 |

---

## 2. 问题摘要

| 严重度 | 数量 | 类别 |
|--------|------|------|
| 🔴 Critical | 6 | 死代码、协议违反、数据一致性 |
| 🟠 High | 4 | 功能缺失、资源泄漏、错误定价 |
| 🟡 Medium | 3 | 竞态、设计缺陷 |
| 🟢 Low | 2 | 性能微优化 |

---

## 3. 🔴 Critical Issues

### C1. SSE Protocol Violation — `done` 事件全部携带 `stream` 字段

**位置**: `sse-poller.ts` 530, 565, 609, 677, 792, 818, 857

**协议规定** (`docs/SSE-EVENT-PROTOCOL-v1.md` 第 91 行):
> **`done` 事件无 `stream` 字段** — done 是纯终止信号，不携带数据

**实际情况**：每一处 `done` 事件 yield 都携带 `stream` 字段，例如：
```typescript
// Line 529-530
yield { type: "done", stream: lang === "zh" ? "执行失败" : "Execution failed", ... };

// Line 792
yield { type: "done", stream: lang === "zh" ? "分析完成" : "Analysis complete", ... };
```

**影响**：前端如果严格按协议解析，可能将 `done.stream` 错误地当作最终内容展示。同时 `chat.ts` 快速路径（233-237 行）的 `done` 也携带了 `stream`。

**建议**：移除 `done` 事件的所有 `stream` 字段，或升级协议版本并在 SSE 协议文档中明确标记此变更为 **v2 break**。

---

### C2. sse-poller.ts — 重复的 `failed` 状态处理（死代码）

**位置**: `sse-poller.ts` 523-539 行 vs 801-823 行

```typescript
// FIRST failed handler (Lines 523-539)
if (currentState === "failed") {
  // ... yield error + done + break
  break; // ← 永远先到达
}

// ... 中间 260+ 行代码 ...

// SECOND failed handler (Lines 801-823) — 100% 死代码
if (currentState === "failed") {
  // NEVER reached because the first handler already broke
}
```

**影响**：第二个 handler 永远不会执行。它有 `if (!sentResult)` 保护（第一个 handler 没有），且它回写 `delegation_logs` 的错误信息（第一个 handler 在慢 Worker 路径下也通过 `execution_status: "failed"` 回写了）。但第一个缺失了 `task_commands` 的状态更新。

**建议**：删除死代码块（801-823），或将两处合并为统一 handler。

---

### C3. Poller 180s 硬超时未更新 `task_commands` 表

**位置**: `sse-poller.ts` 840-862 行

当 poller 检测到 180s 超时时：
- ✅ 回写 `delegation_logs` (842-847 行)
- ✅ 发送 error + done 事件
- ✅ 调用 `markDelivered`
- ❌ **未** 更新 `task_commands` 表状态

**对比**: `task-watchdog.ts` 超时处理会同时更新 `task_archives` + `task_commands` + `delegation_logs`。慢 Worker 的超时处理也更新了 `task_commands`。

**影响**：如果 SSE 连接在 180s 超时触发后断开，对应的 `task_commands` 行将永远停留在 `queued`/`running` 状态，直到 Watchdog（5 分钟）清理。这会导致慢 Worker 错误地重新捡起已完成/已超时的 command。

**建议**：在 poller 的 180s 超时路径中调用 `TaskCommandRepo.updateStatus(commandId, "timed_out")`。

---

### C4. Watchdog 与 Poller 超时字段不兼容

**位置**: `task-watchdog.ts` 81-86 行 vs `sse-poller.ts` 587-589 行

**Watchdog 写入的字段**:
```typescript
await TaskArchiveRepo.setSlowExecution(row.id, {
  timedOutAt: new Date().toISOString(),
  previousState: row.state,
  stuckSince: row.updated_at,
  timeoutReason: `Task stuck in "${row.state}"...`,
});
```

**Poller 读取的字段** (584-589):
```typescript
const timeoutKind = (execution.timeoutKind as string) ?? "soft";
const elapsedMs = (execution.elapsedMs as number) ?? 0;
const thresholdMs = (execution.thresholdMs as number) ?? 0;
```

**不匹配**: Watchdog 写 `timedOutAt` / `previousState` / `stuckSince` / `timeoutReason`，但 Poller 读 `timeoutKind` / `elapsedMs` / `thresholdMs`。导致 Watchdog 触发的超时在 SSE 侧显示为 "⏰ 任务超时 (软超时, 0s / 0s)" — 信息丢失。

**对比**: 慢 Worker 的 `markTimedOut` 写入的是 `timeoutKind` / `thresholdMs` / `elapsedMs`，与 Poller 匹配。

**建议**：统一 Watchdog 的写入字段为 `{ timeoutKind: "watchdog", elapsedMs, thresholdMs: STUCK_THRESHOLD_MS }`。

---

### C5. Worker 停止后无法重新启动

**位置**: `slow-worker-loop.ts` 1330 行, `execute-worker-loop.ts` 216 行

```typescript
export function stopSlowWorker(): void {
  if (!workerStarted) return;
  workerStopped = true;  // ← 只设 stopped，不重置 started
  console.log("[slow-worker] Stopping...");
}

export function startSlowWorker(): void {
  if (workerStarted) {
    console.log("[slow-worker] Already started, skipping");
    return;  // ← 永远返回，无法重启
  }
```

**影响**：优雅关机后，`workerStarted` 仍为 `true`（且 `pollLoop` 的 `.catch` 也可能重置），导致无法重新启动 Worker。这是一个典型的资源泄漏 — 与 `stopTaskWatchdog` 对比，watchdog 的 `startTaskWatchdog` 只检查 `watchdogTimer` 存在即可重启。

**建议**：在 `stopSlowWorker` / `stopExecuteWorker` 中设置 `workerStarted = false`，或在 `startSlowWorker` 中使用 `workerStopped` 而非 `workerStarted` 作为检查条件。

---

### C6. `execute-worker-loop` 缺失 S90P/S91P 取消和超时保护

**位置**: `execute-worker-loop.ts` 全文

- **慢 Worker**: 在入口处（149-176）、fast path（430-431）、cycle callback（659-662）、legacy path（886-889）均检查取消/超时
- **执行 Worker**: 无任何取消/超时检查

**影响**：用户无法取消 `execute_task` 类型的任务，且执行 Worker 的任务没有超时保护。虽然 TaskPlanner + ExecutionLoop 内部可能有自己的超时，但缺乏系统性保护。

**建议**：为 `executePlanCommand` 添加 `checkCancellation` 和 `checkTimeout` 调用，从 `slow-worker-loop.ts` 复用 `TaskCancelledError` 和 `TaskTimedOutError` 类。

---

## 4. 🟠 High Issues

### H1. `estimateCost` 函数被本地定义遮蔽，使用硬编码定价

**位置**: `slow-worker-loop.ts` 1262-1267 行

```typescript
// 第 14 行：从 model-gateway 导入
import { callModelFull, callOpenAIWithOptions } from "../../models/model-gateway.js";

// 第 1262 行：本地重新定义，遮蔽了 token-counter 的导入
function estimateCost(inputTokens: number, outputTokens: number, model: string): number {
  const priceIn = 0.001;
  const priceOut = 0.002;
  return (inputTokens / 1000) * priceIn + (outputTokens / 1000) * priceOut;
}
```

**注意**：`sse-poller.ts` 第 14 行导入了 `{ estimateCost } from "../../models/token-counter"`，但 `slow-worker-loop.ts` 的第 14 行导入没有包括 `estimateCost`。而本地的硬编码版本不区分模型（`model` 参数被忽略）。

**影响**：所有慢 Worker 任务的成本计算使用 Qwen2.5-72B 固定价格，与实际模型无关。

**建议**：删除本地 `estimateCost` 定义，改为从 `../../models/token-counter` 导入。

---

### H2. `markDelivered` 强制设置 `state = 'completed'`

**位置**: `task-archive-repo.ts` 233-237 行

```sql
UPDATE task_archives SET delivered = true, state = 'completed'::text WHERE id = $1
```

**问题**：此方法无条件将 state 设为 `completed`。虽然实际调用路径中，只有 `completed` 状态的代码路径会调用 `markDelivered`（sse-poller.ts 794 行），但如果将来有代码在非 completed 状态下调用此方法，将导致状态篡改。

**建议**：分离 `markDelivered` 的职责 — 只设置 `delivered = true`，不修改 `state`。或者至少添加 `WHERE state = 'completed'` 保护。

---

### H3. Poller 的 180s 超时与 Worker 超时不一致

**位置**: `sse-poller.ts` 840 行
```typescript
if (elapsed > 180_000 && (...) // 硬编码 180s
```

**对比**:
- Worker 软超时: `TASK_SOFT_TIMEOUT_MS`（可配置）
- Worker 硬超时: `TASK_HARD_TIMEOUT_MS`（可配置）
- Poller 超时: 硬编码 `180_000`

**影响**：如果 Worker 的软超时设为 120s、硬超时设为 300s，SSE Poller 会在 180s 就断开连接并报超时 — 即使 Worker 仍在正常执行（硬超时是 300s）。这导致 SSE 客户端提前断开、前端展示不一致。

**建议**：使用与 Worker 相同的 `TASK_HARD_TIMEOUT_MS` 作为 Poller 超时上限。

---

### H4. 慢 Worker 自适应轮询未被使用

**位置**: `slow-worker-loop.ts` 40-44 行 + 1271 行

```typescript
// 第 40 行：定义了自适应轮询
function getPollInterval(elapsedMs: number): number {
  if (elapsedMs < 30000) return 2000;
  if (elapsedMs < 120000) return 3000;
  return 5000;
}

// 第 1271 行：但 pollLoop 使用的是常量
const POLL_INTERVAL_MS = 1000;
// ...
await sleep(POLL_INTERVAL_MS);
```

`getPollInterval` 被定义但从 `pollLoop` 中从未调用。同样的问题也存在于 `execute-worker-loop.ts`（其 `getPollInterval` 未定义但 `POLL_INTERVAL_MS` 也是常量 1000ms）。

**影响**：Worker 轮询始终以固定 1s 间隔运行，不随空闲时间降低频率。长期无任务时浪费 DB 查询。

**建议**：在 `pollLoop` 中使用 `getPollInterval(idleElapsed)` 替代 `POLL_INTERVAL_MS`。

---

## 5. 🟡 Medium Issues

### M1. 两个 `failedChecked` 检查 — 第二个是死代码

**位置**: `sse-poller.ts` 386-410 行 vs 826-837 行

```typescript
// Check 1 (386): query task_commands WHERE status='failed'
// Sets failedChecked = true after completing

// Check 2 (826): if (!failedChecked) { check TaskRepo.getById }
// ← 永远不会执行，因为 Check 1 已设置 failedChecked = true
```

**影响**：无运行时影响（纯粹的 dead code），但第二个检查查询的是 `tasks` 表而非 `task_commands` 表，且逻辑与第一个检查不同。维护者可能误以为两处都有作用。

**建议**：删除第二个 `failedChecked` 检查块。

---

### M2. `sleep` 函数使用 busy-wait 轮询

**位置**: `slow-worker-loop.ts` 1348-1360 行, `execute-worker-loop.ts` 234-245 行

```typescript
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    const check = setInterval(() => {     // ← 每 50ms 触发一次
      if (workerStopped) {
        clearTimeout(timer);
        clearInterval(check);
        resolve();
      }
    }, 50);
  });
}
```

**影响**：即使没有任务，`setInterval` 每 50ms 触发一次循环检查。这是微优化问题，但 Worker 进程中持续运行。

**建议**：使用事件驱动模式替代轮询 — 例如创建一个 `stopped` Promise，用 `Promise.race([sleep(ms), stopped])` 实现可中断 sleep。

---

### M3. 空结果诊断绕过类型系统

**位置**: `sse-poller.ts` 669-677 行

```typescript
const donePayload: Record<string, unknown> = {
  type: "done",
  stream: lang === "zh" ? "执行异常" : "Execution error",
  // ...
};
yield donePayload;  // ← Record<string,unknown> 而非 SSEEvent
```

**影响**：此处变量 `donePayload` 是 `Record<string, unknown>` 而非 `SSEEvent`。TypeScript 在严格模式下可能不会报错，但结构不一致。如果将来 SSEEvent 接口增加必填字段，这里会静默失败。

**建议**：用正确的 `SSEEvent` 类型构造：
```typescript
const doneEvent: SSEEvent = { type: "done", routing_layer: "L2", stream: ..., ... };
yield doneEvent;
```

---

## 6. 🟢 Low Issues

### L1. 首次 progress 事件可能过早触发

**位置**: `sse-poller.ts` 371 行
```typescript
let lastProgressTime = 0;  // 初始值为 0
```
`elapsed - lastProgressTime >= PROGRESS_INTERVAL_MS` 在 `elapsed > 5000ms` 时立即成立（因为 5000-0 >= 5000）。第一个 progress 事件会在第 5 秒后的第一个轮询周期触发，通常是 ~5.5s。这比预期的 "每 5 秒" 稍早一点。

**建议**：将 `lastProgressTime` 初始化为 `startTime` 或 `Date.now()`。

---

### L2. `task-watchdog.ts` 静态 import 未使用

**位置**: `task-watchdog.ts` 11 行
```typescript
import { DelegationLogRepo } from "../../db/repositories.js";
```
此导入在 `scanStuckTasks` 中通过动态 import 使用 `query`。`DelegationLogRepo` 被静态导入但在 `scanStuckTasks` 内部通过 `import("../../db/repositories.js")` 间接使用。无实际影响但风格不一致。

---

## 7. 架构观察

### 正面

1. **Manager-Worker 分离清晰**：SSE Poller、Slow Worker、Execute Worker、Watchdog 四个组件职责明确，互不耦合
2. **数据库队列模式**：`task_commands` 表作为 Worker 队列，支持多 Worker 并发、优先级排序、幂等键
3. **完整性校验**：`updateStateWithIntegrity` 在 done 状态下验证 result 存在，防止空成功
4. **状态机覆盖完整**：`completed` / `failed` / `cancelled` / `timed_out` 四种终态都有对应处理
5. **S90P/S91P 安全保护**：慢 Worker 在多个 LLM 调用点都检查取消/超时
6. **诊断数据安全**：S95P-HF4 workerDiagnostics 只含安全元数据，无 prompt/API key 泄漏

### 改进空间

1. **双超时体系不一致**：Poller、Watchdog、Worker 使用三套不同的超时参数和字段名
2. **workerStarted 生命周期管理**：无法 stop→restart
3. **execute-worker 保护不足**：无取消/超时检查
4. **SSE 协议执行与文档脱节**：done 事件的 stream 字段违反 v1 协议

---

## 8. 建议修复优先级

| 优先级 | Issue | 建议 |
|--------|-------|------|
| P0 | C1 - done 事件 stream 字段 | 移除所有 done.stream，或在协议文档中升级为 v2 |
| P0 | C4 - Watchdog/Poller 字段不兼容 | 统一为 `{timeoutKind, elapsedMs, thresholdMs}` |
| P1 | C3 - Poller 超时未更新 task_commands | 在超时路径中调用 `TaskCommandRepo.updateStatus` |
| P1 | C5 - Worker 无法重启 | 在 stop 函数中重置 `workerStarted = false` |
| P1 | C6 - execute-worker 无取消/超时 | 添加 checkCancellation/checkTimeout |
| P1 | H1 - estimateCost 硬编码 | 改用 token-counter 的 estimateCost |
| P2 | H3 - Poller 超时硬编码 | 使用 TASK_HARD_TIMEOUT_MS |
| P2 | H4 - 自适应轮询未使用 | 在 pollLoop 中使用 getPollInterval |
| P3 | M1 - 死代码清理 | 删除第二个 failed 检查块 |
| P3 | C2 - 重复 failed handler | 删除死代码块 |
| P3 | H2 - markDelivered state 覆盖 | 仅设置 delivered=true |
| P3 | M2 - busy-wait sleep | 使用事件驱动模式 |
| P4 | L1/L2 - 微优化 | 可选修复 |

---

*审查完成：2026-07-07 | 文件数：9 | 发现问题：16*
