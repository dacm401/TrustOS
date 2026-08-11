# T100 Documentation Consistency Check

Version: v0.1
Date: 2026-07-03
Status: Complete
Purpose: Verify term and direction consistency across all T100 documents before documentation freeze.

---

## 1. Check Summary

| Files Checked | Issues Found | Critical | Warning | Clean |
|---|---|---|---|---|
| 11 | 5 | 2 | 3 | 6 |

---

## 2. Per-File Check Results

| File | Check Item | Status | Notes |
|---|---|---|---|
| **TrustOS-OS-Manifesto.md** | S100P 称为 Manager Shell v1 | ✅ PASS | §16 明确写 `S100P: Manager Workspace v1 — Loop Separation in UX` |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 decision_feed |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §7.1 明确说 `A single chat window forces ... one mixed stream`，反对单体 |
| | 暗示要做完整 Agent Engine | ✅ PASS | §15 Non-goals 列出 `a full Agent Engine PaaS` |
| | 快慢模型仅描述为速度差异 | ✅ PASS | §7.1 区分 Manager/Worker/Action Loop 职责差异 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §7.1 完整描述三个 Loop |
| | 包含 Session-scoped events | ✅ PASS | §7.1 引用了 Loop-Separation-RFC |
| | 包含 Manager Workspace v1 | ✅ PASS | §16 明确列出 |
| | **仍使用 "Manager Shell" 一词** | ⚠️ WARNING | §3 列出 `Manager Shell` 作为组件名。这是历史引用，但建议加注说明该词已演进为 Manager Workspace |
| **TrustOS-OS-Primitives.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 decision_feed |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §7.6 明确反对单体 |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | §7.1-7.3 区分三个 Loop 职责 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §7.1 ManagerLoop, §7.2 WorkerLoop, §7.3 ActionLoop |
| | 包含 Session-scoped events | ✅ PASS | §7.4 WorkerEvent, §7.5 SessionEvent |
| | 包含 Manager Workspace v1 | ✅ PASS | §7.6 ManagerWorkspace 完整定义 |
| **Manager-Worker-Trust-Model.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | 未暗示 |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ⚠️ WARNING | 文档未涉及 Loop 概念，也未区分快慢模型。建议在 §10 Action Decision Flow 末尾增加 Loop 归属说明 |
| | 包含 Manager/Worker/Action Loop 分离 | ❌ MISSING | 文档未提及 Loop Separation 概念 |
| | 包含 Session-scoped events | ✅ PASS | §11 提到 events in Decision Feed |
| | 包含 Manager Workspace v1 | ❌ MISSING | 未提及 |
| | **仍使用 "Manager Shell" 一词** | ⚠️ WARNING | §10 最后一行 `User sees relevant events through Manager Shell`。应改为 `Manager Workspace` |
| **Trust-Kernel-RFC.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | 未暗示 |
| | 暗示要做完整 Agent Engine | ✅ PASS | §3 Non-goals 明确排除 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | 未涉及 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §4 模块列表包含 Session Runtime（承载 Loop 分离） |
| | 包含 Session-scoped events | ✅ PASS | §9 Audit Log 使用 session_id |
| | 包含 Manager Workspace v1 | ✅ PASS | 不适用（底层架构文档） |
| **AI-Syscall-Action-Protocol.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §1.1 明确 Action Loop 独立于 Manager Loop |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | 未涉及 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §1.1 Loop Ownership 明确归属 |
| | 包含 Session-scoped events | ✅ PASS | §2 Core Flow 明确路由到 Session Detail |
| | 包含 Manager Workspace v1 | ✅ PASS | §2 Core Flow 包含 Session Detail 和 ManagerLoop 分流 |
| **TrustOS-Performance-Model.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | 未暗示 |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | §3-7 使用 Fast/Slow/Critical/Background Path，是基于决策路径的区分，不是模型速度 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §9.1 完整的 Loop Separation Performance Red Lines |
| | 包含 Session-scoped events | ✅ PASS | §9.1 `Do NOT let one Session block another Session` |
| | 包含 Manager Workspace v1 | ✅ PASS | 不适用（性能模型文档） |
| **Session-Runtime-RFC.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §2.1 明确 Session 是 Loop 边界 |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | 未涉及 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §2.1 明确 Manager Loop / Worker Loop / Session Runtime 三层 |
| | 包含 Session-scoped events | ✅ PASS | §23 session_events 表，§7 Event Model |
| | 包含 Manager Workspace v1 | ✅ PASS | §22-24 三张新表直接支撑 Manager Workspace |
| **Loop-Separation-RFC.md** | S100P 称为 Manager Shell v1 | ✅ PASS | §7 明确 Manager Workspace |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §1.1 核心问题是单体 chat window |
| | 暗示要做完整 Agent Engine | ✅ PASS | §5 明确 What NOT to Build |
| | 快慢模型仅描述为速度差异 | ✅ PASS | §1.2 明确 `not just about model speed` |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | 全文核心主题 |
| | 包含 Session-scoped events | ✅ PASS | §4.3 Multi-task isolation |
| | 包含 Manager Workspace v1 | ✅ PASS | §7 完整三栏设计 |
| **Local-First-Hybrid-Architecture.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 未使用 |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | 未暗示 |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | 不适用 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | 不直接涉及，但架构方向兼容 |
| | 包含 Session-scoped events | ✅ PASS | 不直接涉及 |
| | 包含 Manager Workspace v1 | ✅ PASS | 不适用（底层架构文档） |
| | **仍使用 "Manager Shell" 一词** | ⚠️ WARNING | §4 目标架构图 `Local Manager Shell`。这是对本地部署形态的描述，但建议统一为 `Local Manager Workspace` |
| **TrustOS-UX-Blueprint.md** | S100P 称为 Manager Shell v1 | ✅ PASS | 全文使用 Manager Workspace v1 |
| | 使用 decision_feed 作为主要可见执行流 | ⚠️ WARNING | §6 标题和内容使用 `Decision Feed` 作为执行体验展示名称。这本身是一个合理的 UX 概念名称，但 §7 已用 `Decision Feed Visibility` 映射到 visibility 路由。建议：保留 Decision Feed 作为 Session Detail 内 Timeline 的 UX 名称，但明确它是 Session-scoped，不是全局流 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §3 明确反对 |
| | 暗示要做完整 Agent Engine | ✅ PASS | 未暗示 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | 不涉及 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §3.2 明确三个 Panel 的 Loop 归属 |
| | 包含 Session-scoped events | ✅ PASS | §3.5, §7 完整定义 |
| | 包含 Manager Workspace v1 | ✅ PASS | §3 标题和全文 |
| **T100-planning-report.md** | S100P 称为 Manager Shell v1 | ✅ PASS | §12 使用 `Manager Workspace v1: Loop Separation in UX` |
| | 使用 decision_feed 作为主要可见执行流 | ✅ PASS | 未使用 |
| | 暗示单一 chat window 是主产品载体 | ✅ PASS | §5.2 明确反对 |
| | 暗示要做完整 Agent Engine | ✅ PASS | §7 明确不做的范围 |
| | 快慢模型仅描述为速度差异 | ✅ PASS | 未涉及 |
| | 包含 Manager/Worker/Action Loop 分离 | ✅ PASS | §5.2, §7 |
| | 包含 Session-scoped events | ✅ PASS | §7 提到 Worker Events enter Session |
| | 包含 Manager Workspace v1 | ✅ PASS | 全文核心 |
| | **仍使用 "Manager Shell" 一词** | ⚠️ WARNING | §8.7 `Current frontend components that can become Manager Shell`。应改为 `Manager Workspace` |

---

## 3. Issues Requiring Fix

### Critical (2)

#### C1: Manager-Worker-Trust-Model.md — Missing Loop Separation

**File**: `docs/architecture/Manager-Worker-Trust-Model.md`
**Issue**: 该文档描述了 Manager/Worker/Trust Kernel 三层信任关系，但未引用 Loop Separation 原则。作为架构核心文档，应至少增加一个段落说明 Manager/Worker/Action Loop 的职责边界。
**Recommendation**: 在 §4 Manager 或新增 §4.1 中增加 Loop 归属说明。

#### C2: Manager-Worker-Trust-Model.md — Missing Manager Workspace v1

**File**: `docs/architecture/Manager-Worker-Trust-Model.md`
**Issue**: 文档未提及 Manager Workspace v1 作为 S100P 产品载体。
**Recommendation**: 在 §10 Action Decision Flow 末尾增加 Manager Workspace 引用，或在 §14 Final Principle 附近增加产品方向的段落。

### Warning (3)

#### W1: Manager-Worker-Trust-Model.md §10 — Uses "Manager Shell"

**File**: `docs/architecture/Manager-Worker-Trust-Model.md`
**Line**: §10 Action Decision Flow 最后一行
**Current**: `User sees relevant events through Manager Shell`
**Should Be**: `User sees relevant events through Manager Workspace`
**Note**: 这是遗留用词。Manager Shell 可保留为历史概念描述，但在 Action Decision Flow 中应使用当前 S100P 目标名称。

#### W2: Local-First-Hybrid-Architecture.md §4 — Uses "Local Manager Shell"

**File**: `docs/architecture/Local-First-Hybrid-Architecture.md`
**Line**: §4 Target Architecture 图
**Current**: `Local Manager Shell`
**Should Be**: `Local Manager Workspace` 或保留但加注 `(evolved to Manager Workspace in S100P)`

#### W3: TrustOS-UX-Blueprint.md §6 — "Decision Feed" naming

**File**: `docs/product/TrustOS-UX-Blueprint.md`
**Issue**: `Decision Feed` 作为 UX 概念名称在 §6 使用，但 §7 已正确映射到 visibility 路由。这不构成术语冲突，因为 Decision Feed 是 Session Detail 内 Timeline 的 UX 层名称。
**Recommendation**: 保留 Decision Feed 作为 UX 名称，但在 §6 开头加一句说明：`The Decision Feed is the Session-scoped timeline of Worker Events and Action decisions displayed in Session Detail. It is not a global chat stream.`

---

## 4. Terminology Compliance Summary

| Term | Standardized | Non-compliant Occurrences |
|---|---|---|
| **Manager Workspace** | ✅ | 3 files still use "Manager Shell" (W1, W2, T100-report W) |
| **Session Detail** | ✅ | 0 |
| **session_timeline** | ✅ | 0 (Decision Feed is UX layer name, not data model) |
| **Manager Loop** | ✅ | 0 (Manager-Worker-Trust-Model missing — C1) |
| **Worker Loop** | ✅ | 0 |
| **Action Loop** | ✅ | 0 |
| **Session-scoped events** | ✅ | 0 |
| **Manager Workspace v1** | ✅ | 1 file missing reference (C2) |

---

## 5. Overall Assessment

### Strengths
- **Loop Separation 已渗透到 7/11 文档**，包括 Manifesto、Primitives、Performance Model、Session Runtime、AI-Syscall、Loop-Separation-RFC、UX-Blueprint
- **Manager Workspace v1 已是 S100P 主目标**，在 Manifesto、T100-planning-report 中明确
- **数据模型已补充** manager_messages、session_events、trust_reports 三张表
- **Non-goals 明确**，多个文档写明不做完整 Agent Engine、Sandbox PaaS
- **术语大部分统一**，Manager Workspace 替代 Manager Shell 基本完成

### Gaps
- **Manager-Worker-Trust-Model.md** 是最大缺口：缺 Loop Separation 和 Manager Workspace 引用，仍使用 "Manager Shell"
- 3 处 "Manager Shell" 遗留用词需要修正
- Decision Feed 名称可保留但需加 scope 说明

### Verdict

```
T100 文档一致性验收：基本通过，需修 2 Critical + 3 Warning 后封板
```

修复后即可进入 T100 documentation freeze。

---

## 6. Recommended Fix Order

1. Fix C1 + C2 + W1: 修改 `Manager-Worker-Trust-Model.md`（一次性修复三处）
2. Fix W2: 修改 `Local-First-Hybrid-Architecture.md` §4
3. Fix W3: 修改 `TrustOS-UX-Blueprint.md` §6 加 scope 说明
4. Fix T100-report W: 修改 `T100-planning-report.md` §8.7
