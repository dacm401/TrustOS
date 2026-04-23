# SmartRouter Pro — Phase 1.5 设计草案

> 版本：v0.1-draft | 日期：2026-04-18 | 状态：**规划中，不实现**

---

## 背景与目标

### 现状

LLM-Native Routing 已上线（Phase 1-5 全部完成）。Fast 模型直接响应简单请求，慢模型处理复杂任务。但存在两个问题：

1. **慢模型调用频繁**：简单分析请求也被推到慢模型，成本高、延迟大
2. **上下文累积爆炸**：多轮对话后上下文越来越长，慢模型每次都要处理完整历史

### Phase 1.5 目标

**流量分级 + Orchestrator-Executor 分层架构**，让慢模型只处理真正需要深度处理的请求，且只读结构化任务卡片，不读历史对话。

---

## 核心设计：三层流量分级

```
用户消息
    ↓
[Layer 0 — Fast 直通]
  闲聊 / 简单问答 / 问候 / 感谢
  → Fast 模型直接回复，< 200ms，零成本

[Layer 1 — Fast 任务结晶]
  需要一定处理的请求（分析、代码、创意）
  → Fast 模型生成"任务卡片"（Task Brief）作为中间文档

[Layer 2 — Slow 只读任务卡片]
  复杂任务（深度调研、对比分析、长文写作）
  → Slow 模型只读任务卡片执行，不读历史对话
```

---

## 任务状态机

```
CHATTING        ← 用户闲聊或简单问答，Fast 直通
    ↓
CLARIFYING      ← Fast 判断需要更多信息，向用户确认
    ↓
TASK_READY      ← Fast 已生成任务卡片，等待 Slow 执行
    ↓
EXECUTING       ← Slow 正在执行（只读任务卡片）
    ↓
DONE            ← 执行完成，结果推送用户
    ↓ (可选)
REFINING        ← 用户要求微调，Fast 直接改
```

### 状态转换规则

| 当前状态 | 触发条件 | 下一状态 | 说明 |
|---------|---------|---------|------|
| CHATTING | Fast 判断无需深度处理 | CHATTING | 直接回复 |
| CHATTING | Fast 判断需要分析 | CLARIFYING | 问用户确认意图 |
| CHATTING | 用户明确复杂请求 | TASK_READY | 直接生成任务卡片 |
| CLARIFYING | 用户澄清意图 | TASK_READY | Fast 生成任务卡片 |
| TASK_READY | 任务卡片已生成 | EXECUTING | Slow 开始执行 |
| EXECUTING | Slow 执行完成 | DONE | 推送结果 |
| DONE | 用户要求修改 | REFINE_READY | Fast 局部修改 |
| REFINE_READY | 修改完成 | DONE | 推送修改后结果 |

---

## 任务卡片（Task Brief）Schema

任务卡片是 Fast → Slow 的唯一信息传递介质：

```typescript
interface TaskBrief {
  task_id: string;
  session_id: string;
  task_type: "research" | "analysis" | "code" | "creative" | "comparison";

  // 用户原始请求的精华提取
  instruction: string;         // 核心指令，< 200 字
  constraints: string[];      // 约束条件，如字数、格式、风格
  output_format: string;     // 输出格式，如 "Markdown表格"、"JSON"、".py文件"

  // 上下文补充（不包含历史对话）
  relevant_facts: string[];  // Fast 从记忆/Archive 中提取的相关事实
  user_preference_summary: string;  // 用户偏好摘要

  // 执行标记
  priority: "high" | "normal" | "low";
  max_execution_time_ms: number;  // 超时上限

  created_at: string;
}
```

**关键约束：Slow 模型收到的 context 只能是 Task Brief，不包含历史对话。**

---

## Fast 模型：任务结晶 Prompt

```
你是一个任务整理助手。用户的请求可能是闲聊、简单问答或复杂任务。

请分析用户请求：
1. 如果是闲聊或简单问答 → 直接回复（1-2句话）
2. 如果需要分析/代码/写作 → 生成任务卡片

【任务卡片格式】
task_type: [research|analysis|code|creative|comparison]
instruction: [核心指令，最多200字]
constraints: [约束条件列表]
output_format: [期望的输出格式]
relevant_facts: [从记忆/档案中提取的相关事实]
user_preference_summary: [用户偏好摘要]
priority: [high|normal|low]
max_execution_time_ms: [超时毫秒数，如 60000]
```

---

## Slow 模型：只读任务卡片

```
你是一个执行者。任务信息在下面的【任务卡片】中。

【任务卡片】
{task_brief_json}

请按照任务卡片的指令和约束执行。
不要读取任何外部历史对话，只使用任务卡片中的信息。

输出格式：{output_format}
```

---

## 与现有 Phase 1-5 的关系

### 复用

- **Archive**（Phase 1）：`task_archives` 表继续作为唯一事实源，Task Brief 写入同一表
- **orchestrator**（Phase 2）：扩展 `routing_intent` 分支，增加 Layer 1 判断逻辑
- **web_search 工具**（Phase 2.1）：Fast 在生成 Task Brief 前可以调用 web_search 收集关键信息
- **自适应轮询**（Phase 4）：Slow 执行期间继续使用自适应轮询 + 安抚消息

### 改动

| 组件 | 改动内容 |
|------|---------|
| orchestrator | 增加 Layer 1 任务结晶逻辑（生成 Task Brief） |
| task_archives | 增加 `task_type`/`task_brief` 字段 |
| chat SSE | 增加 `clarifying` 事件类型 |
| Fast model prompt | 扩展任务整理指令 |
| Slow model prompt | 重写为只读任务卡片 |

---

## 实施顺序（Phase 1.5 → Phase 2.0）

### Phase 1.5.1：任务卡片 Schema + Archive 扩展
- 修改 `task_archives` 表，增加 `task_brief JSONB` 字段
- Fast 模型增加任务结晶 prompt（不影响现有路由逻辑）

### Phase 1.5.2：状态机 + Clarifying 流程
- 实现 CHATTING → CLARIFYING → TASK_READY 状态转换
- SSE 增加 `clarifying` 事件，前端展示确认弹窗

### Phase 1.5.3：Slow 模型只读优化
- Slow prompt 重写为只读 Task Brief
- 验证输出质量不掉

### Phase 2.0：完整流量分级
- Layer 0/1/2 完整上线
- Benchmark 增加 Phase 1.5 指标

---

## 风险与缓解

| 风险 | 缓解 |
|------|------|
| Fast 生成 Task Brief 质量差 | Benchmark 测试 + LLM Judge 评分 |
| 用户不愿意澄清意图 | Layer 0 阈值宽松，减少 CLARIFYING 触发 |
| 任务卡片信息丢失 | Archive 持久化 + Slow 读取后验证字段完整性 |
| Phase 1.5 改动破坏 Phase 1 稳定性 | CI 回归门先通过，再上线 Phase 1.5 |

---

_草案日期：2026-04-18，待产品确认用户意图澄清的 UX 流程后正式实施_
