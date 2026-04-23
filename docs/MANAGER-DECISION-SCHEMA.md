# ManagerDecision Schema — Fast 模型结构化输出规范

> **状态：** Phase 2 新增
> **目的：** 替代旧的 `【SLOW_MODEL_REQUEST】` 正则匹配，提供稳定的结构化 Schema 输出 + 校验
> **生效范围：** `orchestrator.ts` → `callFastModelWithTools()`

---

## 输出要求

Fast 模型收到用户请求后，必须**先输出自然语言前缀（1-2句）**，然后输出**单行 JSON**（不带 markdown 代码块）。

### 必须包含的字段（所有 action 均需）

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | 字符串 | 固定值 `"v1"` |
| `action` | 字符串 | 四种动作之一，见下方 |
| `confidence` | 数字 | 置信度 0.0–1.0 |
| `reasoning` | 字符串 | 简短推理，1-2句话 |

### 可选字段（按 action 区分）

| action | 必填字段 | 可选字段 |
|--------|----------|----------|
| `direct_answer` | — | — |
| `ask_clarification` | `clarification.question_text` | `clarification.options` |
| `delegate_to_slow` | `delegation.*` | `delegation.relevant_facts`, `delegation.user_preference_summary`, `delegation.priority` |
| `execute_task` | `execution.*` | — |

---

## action 说明

### `direct_answer`
Fast 模型直接回复，不需要慢模型、不需要澄清、不需要执行模式。
```json
{"version": "v1", "action": "direct_answer", "confidence": 0.95, "reasoning": "用户只是打招呼，直接回复即可。"}
```

### `ask_clarification`
用户请求模糊或不完整，需要向用户提问确认。
```json
{"version": "v1", "action": "ask_clarification", "confidence": 0.85, "reasoning": "用户未指定报告格式，需要澄清。", "clarification": {"question_text": "您想要哪种格式的报告？", "options": ["表格", "Markdown", "JSON"]}}
```

### `delegate_to_slow`
请求升级到慢模型执行。需要填写 `delegation` 对象。
```json
{"version": "v1", "action": "delegate_to_slow", "confidence": 0.78, "reasoning": "需要多角度对比分析，委托慢模型处理。", "delegation": {"action": "research", "task": "对比分析 A/B/C 三种技术方案的优劣势", "constraints": ["输出对比表格", "每个方案至少3个维度"], "query_keys": ["方案A", "方案B", "方案C"], "priority": "normal"}}
```

**`delegation.action`** 的取值：
- `research` — 调研、查找资料
- `analysis` — 深度分析、推理
- `code` — 代码生成、bug 修复
- `creative` — 创意内容生成
- `comparison` — 对比分析

### `execute_task`
需要多步骤执行模式（TaskPlanner + ExecutionLoop）。
```json
{"version": "v1", "action": "execute_task", "confidence": 0.72, "reasoning": "需要多步骤工具调用，触发执行模式。", "execution": {"goal": "帮我查找竞品信息并生成对比报告", "complexity": "high", "max_steps": 8}}
```

**`execution.complexity`** 的取值：
- `low` — 1-2步，简单操作
- `medium` — 3-5步，中等复杂度
- `high` — 6步以上，复杂任务

---

## 完整示例

### 示例 1：直接回复
```
你好！有什么我可以帮你的吗？
{"version": "v1", "action": "direct_answer", "confidence": 0.98, "reasoning": "用户只是打招呼，直接回复即可。"}
```

### 示例 2：请求澄清
```
好的，让我确认一下您的需求。
{"version": "v1", "action": "ask_clarification", "confidence": 0.88, "reasoning": "缺少关键信息：目标受众未知。", "clarification": {"question_text": "这篇报告的目标读者是谁？", "options": ["技术团队", "管理层", "普通用户"]}}
```

### 示例 3：委托慢模型
```
这个问题需要深入分析，让我交给更强大的模型来处理。
{"version": "v1", "action": "delegate_to_slow", "confidence": 0.82, "reasoning": "需要实时股价数据和历史对比，慢模型处理更合适。", "delegation": {"action": "analysis", "task": "分析苹果公司股票近期走势并预测下周趋势", "constraints": ["包含历史数据图表描述", "风险提示"], "query_keys": ["AAPL", "股价", "NASDAQ"], "priority": "normal", "relevant_facts": ["用户持有少量苹果股票"], "user_preference_summary": "偏好简洁的结论+数据支撑"}}
```

### 示例 4：执行模式
```
好的，我来帮你完成这个任务。
{"version": "v1", "action": "execute_task", "confidence": 0.75, "reasoning": "需要多步搜索+整理，触发执行模式更高效。", "execution": {"goal": "查找 2024 年最新 AI Agent 行业报告并整理摘要", "complexity": "high", "max_steps": 10}}
```

---

## 解析失败时的 Fallback 行为

1. **JSON 解析失败** → 降级为 `direct_answer`，Fast 模型文本作为回复内容
2. **字段缺失或类型错误** → 降级为 `direct_answer`
3. **action 值不合法** → 降级为 `direct_answer`
4. **delegation 字段缺失但 action=delegate_to_slow** → 降级为 `direct_answer`
5. **execution 字段缺失但 action=execute_task** → 降级为 `direct_answer`

> **注意：** Phase 2 兼容旧格式——`【SLOW_MODEL_REQUEST】` JSON 仍然可以被 `parseSlowModelCommand` 正确解析，作为向后兼容的 fallback。

---

## 迁移说明（Phase 1 → Phase 2）

| 旧方案 | 新方案 |
|--------|--------|
| `【SLOW_MODEL_REQUEST】{...}【/SLOW_MODEL_REQUEST】` | `{"version": "v1", "action": "delegate_to_slow", ...}` |
| `【CLARIFYING_REQUEST】{...}【/CLARIFYING_REQUEST】` | `{"version": "v1", "action": "ask_clarification", ...}` |
| 正则匹配 `[SLOW_MODEL_REQUEST]` | `parseManagerDecision()` 结构化解析 + 校验 |
| 无 fallback 兜底 | 所有失败路径降级为 `direct_answer` |
