# Sprint 76P — Cycle Runtime SSE Events V0

**Status**: IN PROGRESS
**Author**: 蟹小钳 🦀
**Date**: 2026-05-20
**Parent**: S75P (`69064f2`)

---

## 1. 目标

把 `runCycle()` 的中间执行状态通过 SSE 事件暴露给前端，实现 cycle 级别的实时可见性。

当前 S75P 的问题是：`runCycle()` 在 `slow-worker-loop` 里是同步阻塞执行的，所有 cycle 中间状态（verifying / worker_called / etc.）在任务完成后才通过 done event 一次性返回。前端看到的是"任务完成"之前一片空白。

S76P 修复这个 UX gap，同时为 S77P（人工审核队列）提供事件基础。

---

## 2. 非目标（Non-Goals）

- 不改变 `runCycle()` 的核心行为（cycle logic 不变）
- 不改变 SSE done event payload 结构
- 不接入人工审核队列（S77P）
- 不实现 interrupt / append（S77P+）
- 不实现 parallel workers（S77P+）

---

## 3. 当前状态（Baseline）

### 3.1 SSE Pipeline 路径

```
User → /api/chat (stream=true)
       → routeWithManagerDecision (L2/L3)
       → SSE stream started
         [thinking events here]
         [verification events here]   ← 目前缺失 cycle 事件
       → done event (full result)
```

### 3.2 slow-worker-loop 当前行为

- `runCycle()` 同步阻塞执行
- 中间状态通过 `console.log` 打点，无 SSE 推送
- done event payload 包含完整 `cycleAudit`

### 3.3 runCycle() 当前签名

```typescript
function runCycle(input: RunCycleInput): Promise<RunCycleResult>
// Returns: { finalContent, finalVerification, cycleAudit }
```

---

## 4. 交付物

### D1: CycleEvent 类型定义

**文件**: `src/services/cycle/cycle-events.ts`（新建）

```typescript
export type CycleEventType =
  | "cycle.started"
  | "cycle.verifying"
  | "cycle.verifier_done"
  | "cycle.worker_started"
  | "cycle.worker_done"
  | "cycle.terminal";

export interface CycleEvent {
  type: CycleEventType;
  taskId: string;
  cycleIndex: number;          // 1-based
  timestamp: number;           // Unix ms
  // Payload varies by type:
  recommendedAction?: string;  // verifier_done
  workerCalled?: boolean;      // worker_started / worker_done
  finalStatus?: string;        // terminal
  score?: number;              // verifier_done
  passed?: boolean;            // verifier_done
  error?: string;             // any failure
}
```

### D2: runCycle 增加事件回调参数

**文件**: `src/services/cycle/cycle-runtime.ts`

```typescript
interface RunCycleOptions {
  // ... existing fields ...
  onCycleEvent?: (event: CycleEvent) => void | Promise<void>; // NEW
}
```

在每个关键步骤调用 `onCycleEvent`：

| 时机 | event.type |
|------|-----------|
| 进入 runCycle | `cycle.started` |
| 调用 verifyArtifact 前 | `cycle.verifying` |
| verifyArtifact 返回后 | `cycle.verifier_done`（含 recommendedAction / score / passed） |
| 调用 executeWorker 前 | `cycle.worker_started` |
| executeWorker 返回后 | `cycle.worker_done` |
| 循环结束（任意 terminal 状态） | `cycle.terminal`（含 finalStatus） |

**约束**: `onCycleEvent` 是可选的，不传则 S75P 现有调用完全兼容（向后兼容不变式）。

### D3: slow-worker-loop SSE 事件发射

**文件**: `src/services/phase3/slow-worker-loop.ts`

改造 SSE push 路径：

1. 在任务创建/开始时推送 `cycle.started`
2. 在每个 cycle 节点通过 SSE 中间通道推送事件
3. 保持 done event 完整性不变

**技术方案**: 通过 `ReadableStream` controller 传递 cycle events。

```typescript
// 新增参数：cycleEventStream（WritableStream<CycleEvent>）
// slowWorkerLoop 写入事件 → SSE pipe → 前端消费
```

### D4: SSE done event 补充 cycleAudit

**文件**: `src/api/chat.ts`

done event payload 已有：

```typescript
cycleAudit: (llmNativeResult.requestSummary as any)?.cycleAudit ?? null
```

确保 `cycleAudit` 字段在 SSR/L2 路径（不走 slow-worker-loop 时）也从 `requestSummary` 正确传递。

---

## 5. 不变式

### I1: S75P 行为不变

```typescript
// 不传 onCycleEvent 时，runCycle 行为与 S75P 完全一致
const result = await runCycle({ taskId, taskContract, ... });
// result === S75P result
```

### I2: done event 完整性

done event 的 `cycleAudit` 字段必须包含 S75P 所有字段：
`taskId / totalCycles / finalStatus / recommendedAction / score / anyRevise / anyRewrite`

### I3: 不泄漏 raw artifact / history / memory

CycleEvent payload 只包含元数据（type / cycleIndex / score / recommendedAction / finalStatus），不包含任何 artifact 内容、history 内容或 memory 内容。

### I4: SSE stream 完整性

中间事件错误不中断 SSE stream；done event 始终发送。

---

## 6. 测试策略

### T1: 单元测试 — CycleEvent 类型和生成

- `cycle-events.test.ts`（新建）：验证每种 event type 生成正确
- 覆盖：started / verifying / verifier_done / worker_started / worker_done / terminal

### T2: 单元测试 — runCycle onCycleEvent

- 在 `cycle-runtime-s75p.test.ts` 中新增测试：
  - 验证 onCycleEvent callback 在每个节点被正确调用
  - 验证 event payload 内容正确
  - 验证不传 callback 时行为不变

### T3: E2E — SSE stream 包含 cycle events

- 在 `slow-worker-s76p-e2e.test.ts` 中：
  - 发送 stream=true 请求
  - 验证 SSE stream 包含 `cycle.started` 和 `cycle.verifier_done` 事件
  - 验证 done event 包含 cycleAudit

### T4: Regression Guard — S75P 行为不变

- `npx vitest run --config vitest.s75p.config.ts` 仍 16/16 PASS
- 不传 `onCycleEvent` 的现有调用无行为变化

---

## 7. 架构影响评估

| 模块 | 影响 | 说明 |
|------|------|------|
| `cycle-runtime.ts` | 改造 | 新增可选参数，向后兼容 |
| `cycle-events.ts` | 新建 | 类型定义 |
| `slow-worker-loop.ts` | 改造 | SSE 事件发射通道 |
| `chat.ts` | 最小改造 | done event 已存在，确认字段完整 |
| 现有测试 | 无破坏 | 全部向后兼容 |

---

## 8. 后续路线

- **S77P**: 人工审核队列 — 消费 `cycle.terminal` 事件中 `recommendedAction=human_review` 路径
- **S78P**: Interrupt / append — 消费 `cycle.worker_started` 事件实现可中断 Worker 调用
- **S79P**: SSE progress 事件 — 把每个 Worker 调用内的子步骤也暴露出来
