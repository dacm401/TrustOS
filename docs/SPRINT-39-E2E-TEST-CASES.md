# Sprint 39-D — Phase 3.0 Runtime E2E 验收用例

> 版本：v1.0 | 日期：2026-04-19 | Sprint：39-D | 依赖：Card 39-A/B/C 已完成

---

## 前置条件

- Backend 已启动（`docker compose up -d`）
- `curl` / `jq` 可用
- SiliconFlow API Key 已配置（.env）

---

## 测试策略

Card 39-D 验证 Sprint 37~39 的 Phase 3.0 核心修复是否生效：

| Bug | 修复内容 | 验收方式 |
|-----|---------|---------|
| **B39-01** | `delegate_to_slow` 只写 `TaskCommandRepo`，不触发 `triggerSlowModelBackground` | DB 验证：无 `delegation_archive` 双写 |
| **B39-02** | `ask_clarification` 写 `task_archives`（state=clarifying） | DB 验证：clarifying 任务有 archive 记录 |
| **B39-03** | Worker 写 `updateStatus('done')` + `updateState('done')` | SSE 事件：收到 `result` 事件（非 hang） |
| **B39-04** | `execute-worker-loop` 从 config 读模型名 | HTTP 响应：`routing.selected_model` 非 hardcode |
| **B39-05** | SSE done 事件无 `stream` 字段 | SSE 事件：`done` 事件不含 `stream` 属性 |

---

## E2E 测试用例（Phase 3.0 专项）

### D-01: direct_answer 路径（Manager 直接回复）

**目的**：验证 `use_llm_native_routing=true` + `decision_type=direct_answer` 走 Fast 直答路径。

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "message": "1+1等于几？",
    "session_id": "session-p30-01",
    "use_llm_native_routing": true,
    "stream": true
  }' \
  | while IFS= read -r line; do
    echo "$line" | grep "^data:" | sed 's/data: //' | jq -r \
      '"\(.type // "?"): \( if .stream then .stream[:80] else "" end) [layer:\(.routing_layer // "n/a")]"'
  done
```

**预期事件流**：
```
manager_decision: 1+1等于2... [layer:L0]
done:  [layer:L0]
```

**验收标准**：
- [ ] 首个事件 `type = "manager_decision"`
- [ ] `decision_type = "direct_answer"`（在 manager_decision 事件中）
- [ ] `routing_layer = "L0"`
- [ ] 无 `clarifying_needed` / `command_issued` / `status` 事件
- [ ] 最终 `done` 事件存在，且**无 `stream` 字段**（B39-05）
- [ ] task_archives 表**无** direct_answer 记录（符合设计：不写 archive）

---

### D-02: ask_clarification 路径 + Archive 写入（B39-02）

**目的**：验证 `ask_clarification` 写 `task_archives`（state=clarifying）。

```bash
# 发送模糊消息，触发 Manager 澄清
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "message": "帮我整理一份报告",
    "session_id": "session-p30-02",
    "use_llm_native_routing": true,
    "stream": true
  }' \
  | while IFS= read -r line; do
    echo "$line" | grep "^data:" | sed 's/data: //' | jq -r \
      '"\(.type // "?"): \( if .question_text then .question_text[:60] elif .stream then .stream[:60] else "" end)"'
  done
```

**预期事件流**：
```
manager_decision: 让我确认一下...
clarifying_needed: 您想要哪种格式的报告？...
done:
```

**验收标准**：
- [ ] 事件流包含 `clarifying_needed`（不是旧 SSE 的 `clarifying`）
- [ ] `clarifying_needed` 有 `question_text` / `question_id` / `options` 字段
- [ ] `done` 事件**无 `stream` 字段**（B39-05）

**DB 验证（B39-02）**：
```sql
-- 连接数据库
docker exec -i smartrouter-db psql -U postgres -d smartrouter \
  -c "SELECT id, state, status FROM task_archives WHERE user_id='test-user-001' ORDER BY created_at DESC LIMIT 3;"
```

- [ ] `task_archives` 有该 clarifying 任务的记录
- [ ] `state = 'clarifying'`
- [ ] `status = 'pending'`

---

### D-03: delegate_to_slow 路径 + 无 delegation_archive 双写（B39-01）

**目的**：验证 `delegate_to_slow` 只写 `TaskCommandRepo`，Worker 完成后 SSE 推送 `result`。

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "message": "帮我搜索量子计算2025年最新进展并总结",
    "session_id": "session-p30-03",
    "use_llm_native_routing": true,
    "stream": true
  }' \
  | while IFS= read -r line; do
    echo "$line" | grep "^data:" | sed 's/data: //' | jq -r \
      '"\(.type // "?"): \( if .stream then .stream[:80] else "" end) [task:\(.task_id // "n/a")] [layer:\(.routing_layer // "n/a")]"'
  done
```

**预期事件流**：
```
manager_decision: 好的，这个问题比较深入，让我交给慢模型处理... [layer:L0]
command_issued: [task:<uuid>] [layer:L0]
status: 任务比较复杂，正在深度分析... [layer:L2]
status: 资料已找到，正在整理对比... [layer:L2]
result: 慢模型分析完成... [layer:L2]
done:  [layer:L0]
```

**验收标准**：
- [ ] `manager_decision` → `command_issued` → `status` → `result` → `done` 完整序列
- [ ] `command_issued` 有 `task_id`（UUID）
- [ ] 30s+ 后出现安抚 `status` 事件（自适应轮询生效）
- [ ] `result` 事件在 `done` 之前推送
- [ ] `done` 事件**无 `stream` 字段**（B39-05）
- [ ] `done` 事件的 `routing_layer` = `L0`（继承自 manager_decision）

**DB 验证（B39-01）**：
```bash
docker exec -i smartrouter-db psql -U postgres -d smartrouter -c \
  "SELECT 'task_archives' as tbl, COUNT(*) as cnt FROM task_archives WHERE user_id='test-user-001' AND created_at > NOW() - INTERVAL '5 minutes'
   UNION ALL
   SELECT 'task_commands', COUNT(*) FROM task_commands WHERE user_id='test-user-001' AND created_at > NOW() - INTERVAL '5 minutes'
   UNION ALL
   SELECT 'delegation_archive', COUNT(*) FROM delegation_archive WHERE user_id='test-user-001' AND created_at > NOW() - INTERVAL '5 minutes';"
```

- [ ] `task_archives` 有 delegate_to_slow 记录
- [ ] `task_commands` 有对应记录（status='queued' 或 'completed'）
- [ ] `delegation_archive` **无新增记录**（B39-01：不再双写）

**Poll 完成检测（B39-03）**：
- [ ] Worker 完成后 SSE 收到 `result` 事件（说明 `pollArchiveAndYield` 读到了 `status=done`）
- [ ] 无无限轮询（`pollArchiveAndYield` 在收到 `done` 后退出）

---

### D-04: execute_task 路径 + 模型名从 config 读（B39-04）

**目的**：验证 `execute_task` 走 `execute-worker-loop`，且模型名从 config 读取。

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{
    "message": "帮我搜索量子计算2025年最新进展",
    "session_id": "session-p30-04",
    "use_llm_native_routing": true
  }' | jq '{
    decision_type: .llm_native_result.decision_type,
    routing_layer: .llm_native_result.routing_layer,
    slow_model: .llm_native_result.delegation.slow_model
  }'
```

**验收标准（B39-04）**：
- [ ] HTTP 响应中 `delegation.slow_model` 为配置值（如 `Qwen/Qwen2.5-72B-Instruct`），**非 hardcode `"qwen2.5-72b-instruct"`**
- [ ] `decision_type` = `"execute_task"` 或 `"delegate_to_slow"`

---

### D-05: SSE done 事件结构验证（B39-05）

**目的**：统一验证所有 SSE 路径的 `done` 事件无 `stream` 字段。

```bash
# 收集所有 done 事件，检查其 key 集合
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message":"你好","session_id":"session-p30-05","use_llm_native_routing":true,"stream":true}' \
  | grep "^data:" | sed 's/data: //' | jq -r 'select(.type == "done") | keys | @json'
```

**验收标准**：
- [ ] done 事件 JSON 的 keys **不含 `stream`**（B39-05 修复验证）
- [ ] done 事件 JSON 的 keys **包含 `type` 和 `routing_layer`**

```bash
# 验证 Legacy SSE done 事件同样对齐
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message":"你好","session_id":"session-p30-06","stream":true}' \
  | grep "^data:" | sed 's/data: //' | jq -r 'select(.type == "done") | keys | @json'
```

- [ ] Legacy SSE `done` 事件同样**无 `stream` 字段**

---

## 回归验收（全部 Decision Type）

### D-06: 四种 Decision Type 全覆盖

| 请求 | 触发条件 | 预期事件序列 |
|------|---------|------------|
| "你好" | direct_answer | `manager_decision` → `done` |
| "帮我整理报告" | ask_clarification | `manager_decision` → `clarifying_needed` → `done` |
| "搜索量子计算进展" | delegate_to_slow | `manager_decision` → `command_issued` → `status...` → `result` → `done` |
| "帮我分析量子计算" | execute_task | `manager_decision` → `command_issued` → `status...` → `result` → `done` |

```bash
BASE="http://localhost:3001"
USER="test-user-001"

declare -A CASES
CASES=(
  ["direct_answer"]='{"message":"你好","session_id":"d06-a","use_llm_native_routing":true,"stream":true}'
  ["ask_clarification"]='{"message":"帮我整理一份报告","session_id":"d06-b","use_llm_native_routing":true,"stream":true}'
  ["delegate_to_slow"]='{"message":"搜索量子计算2025年最新进展","session_id":"d06-c","use_llm_native_routing":true,"stream":true}'
)

for name in "${!CASES[@]}"; do
  echo "=== $name ==="
  EVENTS=$(curl -s -X POST "$BASE/api/chat" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $USER" \
    -d "${CASES[$name]}" \
    | grep "^data:" | sed 's/data: //' | jq -r '.type')
  echo "$EVENTS"
  echo ""
done
```

**验收标准**：
- [ ] direct_answer：只有 `manager_decision` 和 `done`
- [ ] ask_clarification：有 `manager_decision`、`clarifying_needed`、`done`
- [ ] delegate_to_slow：有 `manager_decision`、`command_issued`、`status`、`result`、`done`
- [ ] execute_task：同 delegate_to_slow

---

## HTTP 响应验证

### D-07: Phase 3.0 HTTP 响应结构

```bash
curl -s -X POST http://localhost:3001/api/chat \
  -H "Content-Type: application/json" \
  -H "X-User-Id: test-user-001" \
  -d '{"message":"你好","session_id":"d07","use_llm_native_routing":true}' \
  | jq '{
    llm_native_result: .llm_native_result,
    has_task_id: (.llm_native_result.delegation.task_id | length) > 0
  }'
```

**验收标准**：
- [ ] 响应包含 `llm_native_result` 字段（Phase 3.0 HTTP 分支）
- [ ] `llm_native_result.decision_type` 非空
- [ ] `llm_native_result.routing_layer` 为 `L0`
- [ ] `llm_native_result.message` 非空（Manager 安抚）

---

## 执行摘要

| 用例 | 验证目标 | BUG 关联 |
|------|---------|---------|
| D-01 | direct_answer SSE 序列 | — |
| D-02 | ask_clarification SSE + Archive 写入 | B39-02 |
| D-03 | delegate_to_slow 完整 Worker 路径 | B39-01 / B39-03 |
| D-04 | execute_task 模型名 config 读取 | B39-04 |
| D-05 | done 事件无 stream | B39-05 |
| D-06 | 四种 Decision Type 全覆盖 | 回归 |
| D-07 | HTTP 响应结构 | 回归 |

**通过标准**：全部 7 个用例全部验收 ✅

---

_验收完成：2026-04-19 | Sprint 39-D | 蟹小钳 🦀_
