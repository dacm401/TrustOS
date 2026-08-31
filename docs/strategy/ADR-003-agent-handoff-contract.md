# ADR-003：Agent 间交接契约 —— 结构化 Handoff，消灭自然语言侧信道

> **状态**：PROPOSED
> **提出**：2026-08-31，由「问『天为啥蓝』却收到快速排序答案」事故触发
> **影响范围**：Manager → Worker 的任务分发接口、Manager 的 context 装配
> **关联**：`docs/PHASE-3-MANAGER-WORKER-SPEC.md`、`docs/MANAGER-DECISION-SCHEMA.md`、
> `docs/strategy/ADR-001-local-first-egress-processing.md`

---

## 1. 背景

### 1.1 事故

用户连问三条。第二条「天为啥蓝」收到的是**快速排序代码**——上一条问题的答案。

数据库里那条任务的 `user_input`：

```
好的，正在为您生成快速排序代码并解释天空为什么是蓝色的，请稍候...
```

用户问的是四个字，任务输入却是一句模型生成的客套话，还把两条问题缝在了一起。

### 1.2 这不是「多 worker 协调问题」

Boss 的判断很准：**这是 prompt 加工后分发的核心问题，多 worker 时会更明显。**

但要澄清一点——**它不需要多 worker 就会发生**。问题出在 `Manager → Worker`
这条**单向接口**上，与 Worker 的数量无关。多 Worker 只是把同一个缺陷**放大 N 倍**：
N 个 Worker 各自收到被污染的 prompt，且彼此不一致，还可能互相覆盖产物。

换句话说：**我们今天踩的是「接口设计缺陷」，不是「并发协调缺陷」。**
修好接口，多 Worker 才谈得上安全。

### 1.3 我们已经有 envelope 了

值得强调：系统里**早就存在**结构化任务信封（`CommandPayload`）：

```json
{
  "goal": "用Python编写快速排序算法",
  "task_type": "analysis",
  "task_brief": "...",
  "constraints": ["提供可运行的Python代码"],
  "command_type": "delegate_analysis",
  "required_output": { "format": "code" }
}
```

Worker prompt 也确实只读这些字段（`slow-worker-loop.ts:211` 注释：
「构造 Worker Prompt：只读 Archive + Command，不读 history」）。

**那为什么还会出错？** 三个叠加原因，见下节。

---

## 2. 根因分析

### 根因 1：类型混淆 —— 把「给人看的」当成「给机器执行的」

```typescript
// llm-native-router.ts:1065（事故版本）
: (parsedOutput.userFacingText || message);
```

`userFacingText` 是 Manager 生成给用户看的**安抚语**，其来源是 prompt 模板里的：

```
on_task_delegated: "立即回复主人「正在处理，请稍候」，不沉默"
```

这是**自由生成的自然语言**，却被 fallback 成了任务输入。等价于
**把 `printf` 的屏幕输出当成函数返回值来用**。

更糟的是它同时喂给两个语义完全不同的字段：

```typescript
message:        gatedMessage,                                 // → 任务输入
userFacingText: parsedOutput.userFacingText || gatedMessage,  // → 展示文本
```

**同一个字符串承担了两个互斥的职责**：既要给人看（可以寒暄、可以模糊），
又要给机器执行（必须精确、必须完整）。这两类文本的生成目标天然冲突。

> 佐证：同一文件 484 行（policy bypass 路径）写的是 `: message`（正确），
> 只有主路径写错。属**不一致引入的 bug**，而非有意设计。

### 根因 2：envelope 的内容来源是脏的

结构化只约束了「有哪些字段」，**没约束「内容从哪来」**。

`goal` 由 Manager 自由生成，而 Manager 的 context 里塞了 6 轮完整对话：

```typescript
// llm-native-router.ts:1388（事故版本）
// 保留最近 6 轮对话作为上下文，不传全量 history（Manager 只读当前任务）
const recentHistory = history.filter((m) => m.role !== "system").slice(-6);
```

注释宣称「Manager 只读当前任务」，实际塞了 6 轮历史——**名不副实**。

结果 Manager 看到历史里「快速排序」的回复只是分析（看起来没做完），
自主把当前问题并了进去：

```json
"goal": "用Python编写快速排序算法，并解释天空为什么是蓝色的"
```

**envelope 是结构化的，但里面的内容已经被污染。**

### 根因 3：存在自然语言侧信道

同一个语义（任务描述）在系统里有**两条通路**：

| 通道 | 字段 | 来源 | 消费者 |
|---|---|---|---|
| 结构化 | `CommandPayload.goal` / `task_brief` | envelope | Worker prompt ✅ |
| 自然语言 | `task_archives.user_input` | Manager 输出 | `TaskContract.userInstruction` ⚠️ |

`user_input` 被 `buildTaskContract()`（`slow-worker-loop.ts:414`）读走，
用于 cycle runtime 的验收判定。于是 Worker 的**执行依据**与**验收依据**
可能指向两个不同的任务。

> 注意：`userInput` 在 `slow-worker-loop.ts` 里经 `loadArchiveContext()` 返回后
> 并无消费者——说明这条通道是**历史遗留的半成品**，留着只会制造分歧。

---

## 3. 业界怎么做

### 3.1 Anthropic Claude Agent SDK：窄接口 + 单向隔离

Subagent 的核心设计（[官方文档](https://code.claude.com/docs/en/agent-sdk/subagents)）：

> **Context isolation**: each subagent runs in its own conversation, which starts
> fresh... **The only content you pass from parent to subagent is the Agent tool's
> prompt string**... only its final message returns to the parent. The parent
> receives a concise summary, not every file the subagent read.

三个关键点：

1. **唯一入参**：父 → 子只有 Agent tool 的 prompt 字符串，且是**显式构造**的，
   不是从对话流里「捞」出来的
2. **唯一出参**：子 → 父只有 final message，中间过程不外泄
3. **子 agent context 是干净的**（fresh），默认不继承父对话

> 一个细节很能说明其防御深度：Claude Code v2.1.210+ 会**扫描 subagent 的最终
> 消息**，对 `<system-reminder>` 这类控制标签、以及以 `Human:`/`Assistant:`
> 开头的行做转义，防止子 agent 的输出伪造对话边界。
> 这是把「跨 agent 的文本」当成**不可信输入**来处理的态度。

### 3.2 Handoff Contract：信封而非聊天记录

工业界共识（[Handoff Contract 设计](https://htmlpage.cn/topics/ai/ai-agent-handoff-contract-context-transfer)）：

> **Handoff 不是历史 transcript，而是一份可执行 envelope。**

最少要移交 4 类东西：

| 类别 | 为什么必须 |
|---|---|
| 目标与当前状态 | 下一个执行者要知道任务停在哪里 |
| 可复用上下文 | 避免重新读全部历史 |
| 权限与可执行动作 | 避免接手后越权或失能 |
| 未完成风险与副作用 | 避免重复写入或误继续 |

推荐的 envelope 字段：

```json
{
  "handoffVersion": "v3",
  "runId": "run_123",
  "handoffFrom": "planner_agent",
  "handoffTo": "review_agent",
  "currentState": "waiting_review",
  "goal": "validate external send draft",
  "artifactRefs": ["draft_004", "evidence_011"],
  "allowedActions": ["approve", "reject", "edit_and_resume"],
  "openRisks": ["external_send_high_impact"],
  "authoritySnapshot": "policy_bundle_12",
  "resumePolicy": "resume_from_checkpoint_only",
  "ackRequiredBefore": "2026-05-10T10:05:00Z"
}
```

### 3.3 上下文裁剪：控制下一个执行者的注意力

必须区分三档：

- **必须带**：目标、当前状态、关键 artifact、开放风险
- **可选带**：相关历史摘要、最近几步决策理由
- **不应该带**：无关对话、过期草稿、冗余 trace

> 「这不仅是节省 token，更是在**控制下一个执行者的注意力**。」

### 3.4 该文档记录的同类失败模式

> 某个采购审批 agent 把 **40 多轮历史记录原样交给 review agent**……
> **这不是 handoff，只是『把一坨上下文丢给下一个执行者』。**

修复方式是改成「目标 + 当前状态 + 关键 evidence + 可选动作 + 风险摘要」的 packet。
**这与我们的症状是同一个病。**

---

## 4. 决策

采纳四条原则。

### 原则 1：显示文本与执行数据彻底分离

引入**类型层面**的区分，永不混用：

```
DisplayText  —— 给人看：可寒暄、可模糊、可省略  → 只走 SSE / UI
TaskSpec     —— 给机器执行：必须精确、完整、可验证 → 只走 worker
```

**规则：`TaskSpec` 的任何字段都不得由 `DisplayText` 派生。**
（对应根因 1）

已在 `0d27c2e` 落地：任务输入恒为用户原始 `message`。

### 原则 2：envelope 字段的来源约束

结构化不只是「定义字段」，更要**约束内容来源**。对每个字段标注来源：

| 字段 | 允许来源 | 禁止来源 |
|---|---|---|
| `user_input` | 用户原始输入（逐字） | Manager 输出、任何模型生成文本 |
| `goal` / `task_brief` | Manager 基于**本轮输入**生成 | 历史对话中的问题 |
| `constraints` | Manager 生成 / 用户指定 | — |

**规则：`user_input` 必须恒等于用户本轮原话，可用断言在写入时校验。**
（对应根因 2）

### 原则 3：消灭侧信道

任务描述**只能有一个来源**。

- `task_archives.user_input` 降级为**审计字段**（只写不读，供回溯/展示）
- `TaskContract.userInstruction` 改读 `CommandPayload.goal`，不再读 `user_input`
- 清理 `loadArchiveContext()` 返回的、无消费者的 `userInput`

（对应根因 3）

### 原则 4：Manager 的 context 最小化

Manager 的职责是**路由与任务拆解**，不是续写历史。

- 历史**仅用于指代消解**（「它」「再改一下」「刚才那个」）
- 历史在消息层面用 `[conversation_history_begin/end]` 显式包裹并重申隔离规则
- 历史轮数下调（6 → 4），并在 envelope 里明确「历史仅供理解指代」

已在 `0d27c2e` 落地边界标记与隔离指令。

---

## 5. 取舍

| | 做 | 不做（维持现状） |
|---|---|---|
| 正确性 | 任务输入恒为用户原话，不会被模型输出污染 | 依赖 prompt 约束模型「别乱合并」，不可靠 |
| 多 Worker 扩展性 | 每个 Worker 收到同源同构的 envelope | N 个 Worker 各自收脏 prompt，互相覆盖 |
| 可调试性 | 任务描述可追溯到具体字段来源 | 需要反推模型为什么生成这句话 |
| 成本 | 需重构 `TaskContract` 与 `user_input` 语义 | 零成本 |
| 风险 | 改动面涉及 cycle runtime 验收逻辑 | 无 |
| 灵活性 | 降低：Worker 不再能看到「用户到底怎么说的」原文 | 高（但这份自由正是事故来源） |

**关于灵活性的让步，需要澄清**：Worker 拿不到用户原文，看似损失了信息。
但按 Context Boundary 设计，Worker 本就不该消费原始对话——
它需要的上下文应由 Manager **显式写入 envelope**（`artifactRefs` / `constraints`），
而不是让 Worker 自己去猜原文里哪些话算数。**显式传递 > 隐式继承。**

---

## 6. 落地计划

分三步，每步独立可验证、可回滚。

### 阶段 A：止血（已完成，`0d27c2e`）

- [x] `gatedMessage` 不再 fallback 到 `userFacingText`
- [x] `DEFAULT_CORE_RULES` 补三条【任务边界】隔离指令
- [x] `callManagerModel` 用 `[conversation_history_begin/end]` 包裹历史
- [x] 回归测试 `verify-manager-task-boundary.mts`（9 断言）
- [x] 复现验证：Turn2 正确回答瑞利散射，且不再委托 Worker

### 阶段 B：消灭侧信道（推荐下一步）

- [ ] `TaskContract.userInstruction` 改读 `CommandPayload.goal`
- [ ] `task_archives.user_input` 明确标记为审计字段（加注释 + 类型标注）
- [ ] 清理 `loadArchiveContext()` 无消费者的 `userInput`
- [ ] 写入时断言：`user_input` 必须等于本轮用户原话

### 阶段 C：envelope 升级（可选，面向多 Worker）

参考 §3.2 补齐字段，为多 Worker 做准备：

- [ ] `handoffVersion` / `handoffFrom` / `handoffTo`
- [ ] `artifactRefs`（引用而非复制产物内容）
- [ ] `allowedActions`（Worker 能做什么，显式授权）
- [ ] `openRisks`
- [ ] Worker 输出的 **output scanning**（防伪造对话边界，参考 §3.1）

---

## 7. 验证指标

借鉴业界对 handoff 质量的监控建议：

| 指标 | 含义 |
|---|---|
| `post-handoff clarification ratio` | Worker 是否频繁追问——高说明 envelope 信息不全 |
| `task_spec_pollution_rate` | `user_input` 不等于用户原话的比例——**应恒为 0** |
| `goal_history_contamination` | `goal` 中出现历史问题关键词的比例 |
| `envelope completeness rate` | 必填字段缺失率 |

其中 **`task_spec_pollution_rate` 应作为硬断言接入 CI**——它是本次事故的
直接度量，且可以零成本检测。

---

## 8. 一句话总结

> 我们的问题不是「缺 envelope」——envelope 一直都在。
> 问题是**信封旁边还留着一条自然语言的小道**，而信封里的内容
> 又是由一个**看着 6 轮历史、边寒暄边填表**的模型随手写出来的。
>
> 修法不是把小道堵上就完事，而是承认：**给人看的话和给机器执行的指令，
> 从类型上就是两种东西，永远不该共用同一个字符串。**
