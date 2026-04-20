# SmartRouter Pro — SSE 事件协议 v1（FROZEN）

> 版本：v1.0 | 日期：2026-04-19 | Sprint：39-C | 状态：**冻结 ✅**

---

## 1. 协议版本分层

| 版本 | 触发条件 | 状态 |
|------|---------|------|
| **Phase 3.0 SSE（v1）** | `use_llm_native_routing=true` | ✅ 冻结，禁止新增/修改 |
| Legacy SSE | `useOrchestrator=true` / `stream=true` | ⚠️ 维护中，done 语义已对齐 Phase 3.0 |

---

## 2. Phase 3.0 SSE（v1）— 权威协议

> 触发条件：`body.use_llm_native_routing === true` + `body.stream === true`

### 事件序列

```
Client → POST /chat { use_llm_native_routing: true, stream: true }
Server → manager_decision  [立即]
         ↓（如有 delegation）
Server → command_issued     [立即]
Server → status             [30s/60s/120s 安抚，每节点一次]
Server → result             [status=done 时推送]
Server → done               [流结束]
```

### 事件清单

| 事件名 | type 值 | stream 字段 | routing_layer | 触发时机 |
|--------|---------|------------|--------------|---------|
| `manager_decision` | `"manager_decision"` | Manager 回复文本（安抚） | `L0` | Manager 决策后立即 |
| `clarifying_needed` | `"clarifying_needed"` | 无（用 question_text） | `L0` | decision_type=`ask_clarification` |
| `command_issued` | `"command_issued"` | 无 | 同 manager_decision | decision_type ∈ {`delegate_to_slow`, `execute_task`} |
| `status` | `"status"` | 安抚文本 | `L2` | pollArchiveAndYield 推送，30s/60s/120s 节点 |
| `result` | `"result"` | 慢模型完成文本 | `L2` | task.status=`done` |
| `error` | `"error"` | 错误描述 | `L2` | task.status=`failed` |
| `done` | `"done"` | **无** | 同 manager_decision | 流结束，无 payload |

### Payload 结构（JSON）

```typescript
// manager_decision
{ type: "manager_decision", decision_type: string, routing_layer: string, message: string }

// clarifying_needed
{ type: "clarifying_needed", routing_layer: string, question_text: string, options: string[], question_id: string }

// command_issued
{ type: "command_issued", task_id: string, routing_layer: string }

// status
{ type: "status", stream: string, routing_layer: "L2" }

// result
{ type: "result", stream: string, routing_layer: "L2" }

// error
{ type: "error", stream: string, routing_layer: "L2" }

// done（无 stream 字段）
{ type: "done", routing_layer: string }
```

### 关键规则

1. **`done` 事件无 `stream` 字段** — done 是纯终止信号，不携带数据
2. **`status` 事件只有安抚文本** — 不携带结构化数据，前端仅做展示
3. **`result` 事件包含完整回复** — stream 字段携带慢模型最终文本
4. **`routing_layer` 不可为空** — 始终传播，从 manager_decision 继承

---

## 3. Legacy SSE — 对齐后版本

> 触发条件：`useOrchestrator=true` 或 `stream=true`（且 `use_llm_native_routing !== true`）

### 与 Phase 3.0 的差异

| 维度 | Phase 3.0（v1） | Legacy |
|------|----------------|--------|
| 初始安抚事件名 | `manager_decision` | `fast_reply` |
| 澄清事件名 | `clarifying_needed` | `clarifying` |
| done 事件 stream 字段 | **无** | ~~`[delegation_complete]`~~ / ~~`[stream_complete]`~~ → **已移除** |

### Legacy 事件序列

```
Client → POST /chat { stream: true }
Server → fast_reply  [立即，Fast 直接回复]
         ↓（如有 delegation）
Server → clarifying [Phase 1.5 澄清]
Server → status     [30s/60s/120s 安抚]
Server → result     [delegation 完成]
Server → done        [流结束，无 stream]
```

### Payload 结构（JSON）

```typescript
// fast_reply（与 manager_decision 结构相同，语义对齐）
{ type: "fast_reply", stream: string, routing_layer: string }

// clarifying
{ type: "clarifying", stream: string, options: string[], question_id: string, routing_layer: string }

// status / result / error — 同 Phase 3.0

// done（对齐 Phase 3.0：无 stream 字段）
{ type: "done", routing_layer: string }
```

---

## 4. 变更记录

| 日期 | 变更 | 理由 |
|------|------|------|
| 2026-04-19 | 初始冻结（Phase 3.0 SSE v1） | Sprint 39-C |
| 2026-04-19 | Legacy done 事件移除 `stream` 字段 | 与 Phase 3.0 对齐，统一 done 语义 |

---

## 5. 禁止事项（v1）

1. 禁止在 `done` 事件中携带 `stream` 字段
2. 禁止新增与 Phase 3.0 同义不同名的事件
3. 禁止在 Phase 3.0 SSE 中使用 `fast_reply` / `clarifying` 等 Legacy 事件名
4. 禁止修改已冻结的 Phase 3.0 事件序列

如需变更协议，必须通过新的 Sprint 提案，经评审后升级版本号。

---

## 6. 前端消费指南

```typescript
// SSE 事件消费逻辑
for await (const line of sseStream) {
  const event = JSON.parse(line);
  switch (event.type) {
    case "manager_decision":
    case "fast_reply":
      // 初始安抚消息，显示在 chat 区域
      break;
    case "clarifying_needed":
    case "clarifying":
      // 显示澄清 UI
      break;
    case "command_issued":
      // 显示 loading spinner
      break;
    case "status":
      // 显示安抚文本
      break;
    case "result":
      // 显示慢模型回复
      break;
    case "error":
      // 显示错误提示
      break;
    case "done":
      // 流结束，移除 loading 状态
      break;
  }
}
```

> 注意：`manager_decision` 和 `fast_reply` 语义相同，可合并处理；`clarifying_needed` 和 `clarifying` 语义相同，可合并处理。

---

_冻结：2026-04-19 | Sprint 39-C | 蟹小钳 🦀_
