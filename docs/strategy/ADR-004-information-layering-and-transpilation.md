# ADR-004：信息分层与转译模型

> **状态**：PROPOSED
> **提出**：2026-08-31
> **触发**：Boss 三问 ——① 原始输入给 Worker 与规避敏感信息是否矛盾？
> ② 上下文累计与 memory 不给 Worker 是否矛盾？③ 怎么解决？
> **关联**：`ADR-001-local-first-egress-processing.md`（外发加工）、
> `ADR-003-agent-handoff-contract.md`（Handoff 契约）、
> `docs/PHASE-3-MANAGER-WORKER-SPEC.md`

---

## 1. 背景

ADR-003 处理完「问『天为啥蓝』却收到快速排序答案」之后，Boss 提出三个问题。
这三个问题**不是挑刺，而是指向 ADR-003 尚未覆盖的一层**：当我们要把信息
从一个 agent 交给另一个 agent 时，信息的**形态**该如何决定？

三个问题其实是同一个矛盾的三个切面：

| # | 问题 | 矛盾的两极 |
|---|---|---|
| ① | 原始输入给 Worker vs 规避敏感 | **保真** vs **最小权限** |
| ② | 上下文累计 vs memory 不给 Worker | **个性化** vs **最小权限** |
| ③ | 怎么解决 | —— |

---

## 2. 现状盘点（带代码证据）

在给方案之前，先把系统的真实状态摸清楚。有四处关键事实，其中**两处是隐患**。

### 2.1 ✅ 已有：egress 加工管道（语法级）

ADR-001 建立了外发强制加工，覆盖 10 类模式：私钥、API key、Bearer、JWT、
邮箱、手机、身份证、银行卡等。所有 `callModelFull` 路径统一加工。

**性质**：**语法级**（正则模式匹配），不理解语义。

### 2.2 ✅ 已有：memory 敏感分级（但未被用于过滤）

`src/services/mwt6/memory-governance-core.ts` 定义了完整的敏感度分级：

```typescript
const EXPLICIT_SENSITIVITIES = new Set([
  "public", "internal", "sensitive", "restricted", "unknown",
]);
```

且默认最小权限：

```typescript
if (sens === "sensitive" || sens === "restricted") return "limited";
if (!sens || !EXPLICIT_SENSITIVITIES.has(sens)) return "limited";   // 未知→受限
if (sens === "unknown") return "limited";   // "never public"
```

**这套分级是成熟的，但目前没有被用于决定「能不能上云」。**

### 2.3 ⚠️ 隐患：memory 检索了，却从未被使用

```typescript
// llm-native-router.ts:685
[managerOutput, userMemories] = await Promise.all([
  callManagerModel({ message, history, ..., userMemories: undefined }),  // ← undefined
  memoryPromise,                                                          // ← 确实检索了
]);
```

```typescript
// llm-native-router.ts:1127-1128
memoryWasRetrieved: userMemories !== undefined,
memoryWasSentToManager: false, // callManagerModel 传入 undefined
```

检索链路是完整的（337-374 行：hybrid retrieval → injection engine → 详细日志），
但结果**只进入日志与统计，从未进入任何 prompt**。

**memory 目前是一个被架空的模块：完整实现，零实际作用。**

### 2.4 ⚠️ 隐患（决定性）：`target` 参数不过滤，只改标题

`injector.ts` 的设计意图写得很好：

```
 * Memory injected into a LOCAL model never leaves the machine, so it needs no
 * egress processing. Memory destined for a CLOUD model must be processed.
 * `target` makes this explicit rather than a global flag...
```

但实现只完成了一半。`target` 的唯一作用是渲染不同的标题：

```typescript
// injector.ts:404
block: renderBlock(selected, target),

// injector.ts:458-467
const header = target === "local"
  ? "## 关于用户（本地记忆，未外发）"
  : "## 关于用户（记忆摘要，外发前已经过加工）";
```

**`target="remote"` 与 `target="local"` 选出的 memory 集合完全相同。**
注释把安全责任推给了下游 egress：

```
 * For a REMOTE target the block is expected to pass through
 * egress processing downstream (see egress-processor.ts), so we only mark it.
```

**这正是问题所在**——见下节。

---

## 3. 核心论点：egress 与敏感性之间存在「语义断层」

egress 是**语法级**的，memory 的敏感性是**语义级**的。二者不在同一个层面。

| 例子 | egress 正则能识别吗 | 语义上敏感吗 |
|---|---|---|
| `sk-AbCdEf1234567890` | ✅ 能（私钥模式） | 是 |
| `alice@corp.com` | ✅ 能（邮箱模式） | 是 |
| `13800138000` | ✅ 能（手机模式） | 是 |
| 「用户的老板叫张伟」 | ❌ **不能** | **是** |
| 「用户年薪 80 万」 | ❌ **不能** | **是** |
| 「用户在準備离职」 | ❌ **不能** | **是** |
| 「用户是 Python 后端工程师」 | ❌ 不能 | 否（可安全转译） |

**结论**：ADR-001 的 egress 管道只覆盖了「长得像敏感信息」的那部分。
对 memory 这种**自由文本、语义敏感**的内容，egress 是失效的。

因此：

> **memory 上云的安全保障，不能建立在 egress 之上。
> 必须在「选择阶段」按 sensitivity 过滤——这是唯一能在语义层面把关的位置。**

---

## 4. 决策：三层信息模型

### 4.1 核心原则

> **信息不是「给不给」的二元选择，而是「以什么形态给」的光谱。**

```
原文 → 摘要 → 结构化字段 → 脱敏 → 不给
```

矛盾无法被消除，只能在**正确的层级做正确的形态转换**。
我们的任务是：为每一对 agent 之间的每一条通道，明确选择光谱上的位置，并**可验证**。

### 4.2 三层模型

| 层 | 内容 | 位置 | 形态转换 | 消费者 |
|---|---|---|---|---|
| **L0 原始层** | 用户原话、memory 原文、历史全文、artifact 原文 | 本机，**永不出境** | 不加工（保真） | 审计、回溯、memory 提炼 |
| **L1 转译层** | Safe View、提炼后的偏好 | 本机→云端边界 | **过滤 + 摘要 + 提炼** | Manager |
| **L2 分发层** | envelope（goal / constraints / task_brief） | 云端 | 结构化 + egress 脱敏 | Worker |

数据流向：

```
用户原话 ──┬──→ [L0 存储] user_input（保真，审计用）
           │
           └──→ [L1] Manager（Safe View + memory 提炼）
                      │
                      └──→ [L2] envelope ──→ [egress] ──→ Worker

memory ────┬──→ [L0 存储]（保真）
           └──→ [sensitivity 过滤] ──→ [L1] Manager 提炼成 constraints
                                            │
                                            └──→ [L2] envelope ──→ Worker
```

### 4.3 四条规则

**规则 1｜L0 永不出本机**
用户原话、memory 原文、历史全文只存本地。任何出境行为都发生在 L1 之后。

**规则 2｜L0→L1 是转译，不是复制**
过滤、摘要、提炼。`buildManagerView()` 已是现成范例：

```typescript
// manager-view.ts:153-173
// 规则 1: Worker artifact 不进入 Manager
if (origin === "worker" && contentKind === "artifact") {
  safe.push({ role: "assistant", content: `[Worker结果摘要] ${fallbackSummary(msg)}` });
}
```

**artifact 原文不给，但摘要给**——这就是转译。方向正确，memory 这条线照此办理。

**规则 3｜L1→L2 是结构化，不是转发文本**
Manager 填 envelope，Worker 只读 envelope。禁止任何自然语言直通通道
（ADR-003 已确立）。

**规则 4｜L2 必过 egress**
egress 是最后一道网，拦截「长得像敏感信息」的漏网之鱼。
**它是必要的，但不是充分的**——不能替代规则 2 的语义把关。

---

## 5. 逐条回答 Boss 三问

### ① 原始输入给 Worker vs 规避敏感：矛盾，但矛盾的一半是表述问题

「给 Worker 原始输入」这句话混淆了两个动作：

| 动作 | 位置 | 要求 |
|---|---|---|
| **存储** | 本机 | **保真**（ADR-001：原文存本机） |
| **分发** | 发往云端 | **加工** |

只要存储与分发走**不同通道**，就不矛盾：
- `user_input` 存原话 → 本机，用于审计/回溯（**保真**）
- Worker 只读 envelope → 经 egress（**加工**）

**ADR-003 的表述需要修正**：「`user_input` 必须恒等于用户原话」是对的，
但必须补上一句——**`user_input` 是审计字段，不进 Worker**。
否则 Worker 直接读 `user_input` 就等于绕过 egress 直穿。

> 补充：这也回答了「那 Worker 怎么知道用户到底怎么说的？」
> **它不需要知道。** 用户原话里哪些话算数，是 Manager 的职责——
> Manager 应当把它提炼进 `goal` / `constraints`。
> **显式传递 > 隐式继承。**

### ② 上下文累计 vs memory 不给 Worker：矛盾，而我们用了最差的解法

现状是把 memory **整个废弃**（传 `undefined`）。这等于：

> 为了避免车祸，把车锁进车库。安全了，但也失去了出行能力。

正确解法是**转译，不是切断**：

```
memory: "用户是 Python 后端工程师，喜欢类型注解，讨厌过度抽象"
   ↓  Manager 读取并转译
constraints: ["使用类型注解", "避免过度抽象的设计模式"]
   ↓
Worker：产出符合偏好，但不知道用户是干嘛的
```

**个性化保留了，语义敏感信息没外泄。**

关键原则：**个性化信息应当「降维传递」**——
不是原文传递（泄露），也不是彻底切断（残废），而是提炼成无敏感信息的约束。

### ③ 怎么解决：三层模型 + 按 sensitivity 过滤

见 §4 与 §6。

---

## 6. 落地变更

按风险从低到高排序，每步独立可验证、可回滚。

### 阶段 A：明确通道语义（低风险，纯澄清）

- [ ] `task_archives.user_input` 标注为**审计字段**（只写不读），补类型注释
- [ ] `TaskContract.userInstruction` 改读 `CommandPayload.goal`
- [ ] 清理 `loadArchiveContext()` 返回的、无消费者的 `userInput`
- [ ] 断言：`user_input` 必须恒等于本轮用户原话（接入 CI）

### 阶段 B：堵住 memory 的语义泄露口（中风险，**必须在打通之前做**）

- [ ] `selectMemoriesInner()` 按 `target` 过滤 sensitivity：

| sensitivity | target=local | target=remote |
|---|---|---|
| `public` | ✅ 注入 | ✅ 注入 |
| `internal` | ✅ 注入 | ⚠️ **仅转译后注入** |
| `sensitive` / `restricted` | ✅ 注入 | ❌ **拒绝** |
| `unknown` | ✅ 注入 | ❌ **拒绝**（默认最小权限） |

- [ ] `renderBlock()` 的 header 不再只是"标记"，而是**与过滤结果一致**的声明
- [ ] 补充测试：`target="remote"` 时，任何 `sensitive`/`restricted` 条目都不出现在结果里

> ⚠️ **顺序不能颠倒**：阶段 B 必须在阶段 C 之前。
> 否则就是把未过滤的 memory 直接送上云。

### 阶段 C：打通 memory → Manager（中风险，新功能）

- [ ] `callManagerModel({ userMemories: undefined })` → 改为传入过滤后的 block
- [ ] 目标选择：优先 **`local`**（若未来接入本地小模型）；当前云端模型下走 `remote` + 阶段 B 过滤
- [ ] Manager prompt 里明确 memory 的来源与可信度（`prompts/manager/v4.ts:240` 已有注入点）

### 阶段 D：memory → constraints 转译（较高风险，需设计）

- [ ] Manager 负责把 memory 提炼成 `constraints`，而非转发原文
- [ ] envelope 增加字段标注约束来源（`source: "user_stated" | "memory_derived"`），
      便于审计与用户查看「为什么 AI 这么做」

---

## 7. 取舍与风险

| | 做 | 不做 |
|---|---|---|
| **安全性** | 语义级把关（sensitivity 过滤）+ 语法级兜底（egress） | 只有语法级兜底，语义敏感信息裸奔 |
| **个性化** | memory 经转译后生效 | memory 完全废弃，所有用户一视同仁 |
| **可审计性** | 每个字段可追溯到 L0/L1/L2 哪一层 | 无法回答"这条信息谁看过" |
| **成本** | 需实现过滤 + 转译 + 标注 | 零成本 |
| **风险** | 阶段 C/D 会让 memory 上云，若过滤有洞即为泄露 | 无新增风险 |
| **复杂度** | 增加一层概念（L0/L1/L2） | 保持现状 |

### 主要风险与缓解

**风险 1：memory 上云后泄露语义敏感信息**
- 缓解：阶段 B 的「默认拒绝」策略（`unknown` 一律拒绝上云）+ 阶段 B 必须先于阶段 C
- 兜底：egress 仍会拦截格式化的敏感信息

**风险 2：转译丢失信息，导致产出不符合用户真实意图**
- 缓解：envelope 标注来源，用户可查看「AI 因为什么记忆做了这个决定」
- 兜底：转译失败时降级为"不注入该条 memory"，而非"注入原文"

**风险 3：过度设计，三层模型成为负担**
- 缓解：L1 的转译逻辑复用现有 `buildManagerView()`，不新增抽象层
- 衡量：若阶段 A/B 完成后系统无实质变化，说明分层过重，应简化

---

## 8. 验证指标

| 指标 | 期望 | 说明 |
|---|---|---|
| `user_input_pollution_rate` | **0** | `user_input` ≠ 用户原话的比例（ADR-003 已确立） |
| `remote_memory_sensitivity_violations` | **0** | `target=remote` 时出现 sensitive/restricted 条目 |
| `memory_utilization_rate` | 从 **0** 提升 | memory 被实际注入的比例（当前为 0） |
| `memory_derived_constraint_ratio` | 观察值 | 多少 constraints 来自 memory 转译 |
| `egress_redaction_rate` | 观察值 | 若 memory 上云后该值飙升，说明过滤没做好 |

其中前两项应作为**硬断言接入 CI**——它们是可零成本检测的安全不变量。

---

## 9. 与既有 ADR 的关系

| ADR | 解决什么 | 层级 |
|---|---|---|
| **ADR-001** | 外发必加工 | **语法级**（正则脱敏） |
| **ADR-003** | Handoff 结构化，消灭自然语言侧信道 | **接口级**（字段与通道） |
| **ADR-004**（本） | 信息分层与转译 | **语义级**（什么形态给谁） |

ADR-004 是 ADR-001 的**语义补充**：ADR-001 解决了「长得像敏感信息」的部分，
本 ADR 解决「语义上敏感但格式普通」的部分。两者叠加才构成完整的信息管控。

---

## 10. 一句话总结

> 信息不是「给不给」的开关，而是「以什么形态给」的光谱。
>
> 安全与个性化的矛盾无法消除，只能**在正确的层级做正确的转换**：
> L0 保真留存本地，L1 转译提炼，L2 结构化分发。
>
> 而我们目前最危险的地方，是把「memory 上云」的安全责任
> 交给了一个只认正则、读不懂语义的 egress 管道——
> 它拦得住 `sk-xxx`，拦不住「用户的老板叫张伟」。
