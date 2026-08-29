# TrustOS 开发考古：2026-03 → 2026-08 方向演变与遗留审计

> **用途**：追溯开发以来方向的变化；识别被改掉的原优点、废而未除的代码。
> **方法**：读取 `WorkBuddy/` 下 158 个日期目录中的开发记录（多数 `MEMORY.md` 为空，
> 有效内容集中在 `20260416102442`、`20260507230038`、`20260526092546` 等目录），
> 结合当前代码库交叉验证。
> **日期**：2026-08-29

---

## 0. 史料说明（重要）

158 个日期目录中，**绝大多数只含 1 个 `MEMORY.md` 且为 0 字节或极小**——
它们是每次对话自动生成的空记忆占位，无史料价值。

真正有内容的目录只有少数：

| 目录 | 内容 | 价值 |
|---|---|---|
| `20260416102442` | 逐日日志 04-16~05-08 + `PHASE-0-5-AUDIT` + `delegate_fix_report` | ⭐⭐⭐ 最丰富 |
| `20260507230038` | 逐日日志 05-08~05-18 + `HANDOFF.md` | ⭐⭐⭐ |
| `20260526092546` | `MEMORY.md`（20KB，S84P–S97P Sprint 状态） | ⭐⭐⭐ |
| `20260407104107` | 22068 文件（含 node_modules，多为第三方 README/LICENSE） | ⭐ 需甄别 |
| `20260411121532`、`20260414162112`、`20260416214742` | `HANDOFF.md` / `MEMORY.md` | ⭐⭐ |

⚠️ `20260407104107` 下大量 md 是**第三方依赖的 README/LICENSE**，非本项目文档，已排除。

---

## 1. 方向演变：五个阶段

| 阶段 | 时间 | 产品定位 | 核心命题 |
|---|---|---|---|
| **Ⅰ 起步** | 03 | （记录极少，MEMORY.md 为空） | — |
| **Ⅱ 路由性能产品** | 04 | **SmartRouter Pro** | 「用便宜的快模型正确处理大多数请求，贵的慢模型只处理必要的」 |
| **Ⅲ 工程化与体验** | 05 | SmartRouter Pro | 性能、Context Boundary、前端整合、可观测 |
| **Ⅳ 可信 AI 操作系统** | 06–07 | **TrustOS** | 「Observe→Assess→Control→Prove→Evidence」可验证闭环 |
| **Ⅴ 个人 PC OS + 主权** | 08 | TrustOS（个人 PC 操作系统） | 「本地优先 + 数据主权 + 可验证」 |

### 关键转折

| 时间 | 转折 | 证据 |
|---|---|---|
| **04-24** | **废弃 Orchestrator 路径**，LLM-Native 成为唯一默认路由 | `2026-04-24.md` |
| **05-12** | Context Boundary V0/V1 建立（Worker 不碰原始数据） | `2026-05-12.md` |
| **06–07** | 项目改名为 TrustOS，重心从"路由省钱"转向"可验证证据" | `TRST-0` 系列文档 |
| **08-24** | Boss 定位为**个人 PC OS**，多租户被剔除 | `TRST-5-discussion-2026-08-24.md` |
| **08-29** | **护栏重述**：本地存原文 + 外发加工 + 数据主权 | `ADR-001` / `ADR-002` |

**最根本的变化**：从「**省钱的路由器**」→「**可信的执行环境**」→「**主权数据平台**」。
每阶段都保留了前一阶段的能力（路由、Context Boundary 都还在），
但**产品叙事和重心**发生了迁移。

---

## 2. 各阶段主要成果

### Ⅱ 阶段（04）：路由能力建设 —— 这部分最扎实

| 成果 | 指标 | 现状 |
|---|---|---|
| Intent 分类器重写 | 50.8% → **100%（59/59）**，后调优至 97% | ✅ 仍在用（`chat.ts:269`） |
| 路由准确率 | 39% → 76.3% → 89.8% → **94.9%** | ✅ |
| **KB-1 知识边界信号** | 8 signal / 6 cluster / 24 pattern | ✅ **完整保留且在 gating 链路活跃** |
| Gated Delegation v2（G1~G4） | Action Score Head + Policy Gate + Reranker + Learning Loop | ✅ 现为 G0-G4 |
| Manager-Worker 架构 | Phase 3.0 启动 | ✅ 核心架构 |
| `cleanFastReply()` | 根治 7B 乱码（大小写变体/裸 JSON/控制字符/重复句） | ✅ |
| 测试体系 | 447→465→484 通过 | ✅ 现 205 断言（verify:trust） |

### Ⅲ 阶段（05）：工程化

- Embedding LRU 缓存、Circuit Breaker 修复与注入
- 前端 React Query 大统一（消除 useEffect+fetch）、21 处 `any` 清零
- Context Boundary V0/V1
- Sprint 76 性能与可观测面板

### Ⅳ 阶段（06–07）：可信闭环

S84P–S97P：性能链路（看见慢→控制慢→理解结束原因→可视化监控→质量基线→路由稳定→反馈闭环）
+ TRST-0/1/2/3（战略基线、执行追踪、产品闭环、Private Beta）

### Ⅴ 阶段（08）：主权数据

MWT 系列 + TRST-5 + 主权数据层 + L0 蒸馏 + 注入闭环（本机）

---

## 3. ⚠️ 被改掉 / 名存实亡的原优点

这是本次审计最重要的发现。

### 3.1 🚨 Delegation Archive 的「O(1) token 检索模型」已名存实亡

**原设计（04-16，O-005）**：
> 建 `delegation_archive` 表 + `DelegationArchiveRepo`，确立
> **「新任务开新对话、查档案库」的 O(1) token 模型**

即：重复/相似问题不重新调用 LLM，而是查历史档案直接回答——这是**省钱的核心机制**，
也是早期产品的差异化价值。

**现状（代码验证）**：
- `DelegationArchiveRepo` 的**读方法（`list` / `getRecent`）无任何外部调用方**
  （全库搜索仅命中 `delegation.ts` 内部自己用的 `getById`）
- 仅 `slow-worker-loop.ts:8` 注释：
  > 「兼容旧 `triggerSlowModelBackground`：也写 `delegation_archive`（**backward compat**）」

**判定**：该表现在是**只写不读**。

| 项 | 状态 |
|---|---|
| 写入 | ✅ 仍在写（兼容路径） |
| 读取（查档案库回答） | ❌ **无调用方** |
| 原 O(1) token 价值 | ❌ 已丧失 |

**这是明确的一处「优点被改掉」**：一个能显著降低 token 消耗的机制，
现在只剩写入开销，没有读取收益。

> 注：这与本项目后来的定位（可验证、证据）有关——重心从"省钱"移走了。
> 但作为资产，`delegation_archive` 的数据仍可能有价值（可用于分析或恢复该能力）。

### 3.2 旧 `/chat-result` 轮询端点已废弃

`chat.ts:1069`：
> 「旧 `/chat-result` 端点已废弃（委托结果通过 LLM-Native SSE 实时推送，无需轮询）」

对应 04-16 的 O-002（前端 `pollDelegation` 轮询）——**已被 SSE 取代**，属合理演进。

### 3.3 Phase 5 LocalArchiveStore 降级为兼容

`phase5/local-archive-store.ts:159` 标注为
> `// ── Legacy LocalArchiveStore (向后兼容) ──`

且 `:239` 有 `// legacy, skip for now`。
真正的实现是 `LocalArchiveStorage`（被 `storage-registry.ts`、`storage-backend.ts` 动态 import）。
**旧类仍在导出**（`phase5/index.ts:13`），但已标注 legacy。

---

## 4. 🗑️ 废而未除的代码（仍在文件中）

按类型分类。判定依据均来自实际代码搜索。

### 4.1 只写不读的数据结构

| 项 | 位置 | 证据 |
|---|---|---|
| `DelegationArchiveRepo.list/getRecent` | `src/db/repositories/delegation.ts` | 全库无外部调用方 |

### 4.2 已标注废弃但仍导出/存在

| 项 | 位置 | 说明 |
|---|---|---|
| `LocalArchiveStore`（legacy 类） | `src/services/phase5/local-archive-store.ts:165` | 注释标 legacy，仍从 `index.ts` 导出 |
| `forwardMcpRequest` / `validateMcpRequest` / `extractMcpName` | `src/services/trst1/mcp-passthrough-forwarder.ts:87,127,171` | 均 `@deprecated`，且 MCP 未接入主链路 |
| `routing_correct` 字段 | `src/types/task.ts:214` | `@deprecated` — 注释坦承「previously reflected **fake** routing_correct data」 |
| `repositories.ts`（旧单体文件） | `src/db/repositories.ts:2` | 自标 `DEPRECATED`，现仅 re-export |

### 4.3 前端孤儿组件（定义但未被 import）

以下 `.tsx` 在全库搜索中**没有任何 import 语句**引用（排除同名字符串误伤）：

```
components/chat/ActionBar.tsx
components/chat/CodeBlock.tsx
components/chat/PreviewPane.tsx
components/dashboard/AdminPanel.tsx
components/dashboard/BetaPanel.tsx
components/dashboard/DecisionTimeline.tsx
components/dashboard/DelegationLogsPanel.tsx
components/dashboard/GrowthChart.tsx
components/dashboard/LearningPanel.tsx
components/dashboard/StatsCards.tsx
components/dashboard/TokenSankey.tsx
components/layout/CommandPalette.tsx
```

⚠️ 其中 `LearningPanel`、`TokenSankey` 在 05-09 日志中记录为「已集成到 DashboardView」，
说明**后来集成被回退或重构时移除，组件文件却留了下来**——
这正是「废掉的代码还在文件中」的典型。

### 4.4 遗留的兼容分支（大量）

`slow-worker-loop.ts` 中大量 legacy 分支仍在：
```
:8    // 兼容旧 triggerSlowModelBackground：也写 delegation_archive（backward compat）
:553  return; // Early return — skip all cycle/legacy logic below
:597  // ── Normal Path: Cycle Runtime or Legacy ──
:898  // ── Legacy 路径（无 criteria / TaskContract 构建失败）──
:941  // Patch logic (legacy)
:1058 // ── Verifier V0 legacy 兜底（无 criteria 时）──
:1113 // Sprint 65P: Verifier V0 结果（legacy）
```

这些是**双轨并存**：Cycle Runtime（新）与 Legacy（旧）同时保留。
功能上正确（渐进迁移），但增加了复杂度。

### 4.5 未接入的组件（此前已知）

- `frontend/src/components/views/MemoryView.tsx`
- `frontend/src/components/views/OverviewView.tsx`
- `frontend/src/app/dashboard/layout.tsx`（孤立 layout，同目录无 page.tsx）

---

## 5. ✅ 保留完好且仍活跃的原优点

为避免只报问题，也确认哪些优点**被完整保留**：

| 原优点 | 现状 | 证据 |
|---|---|---|
| **KB-1 知识边界信号** | ✅ 完整保留且在 gating 链路活跃 | `knowledge-boundary-signals.ts`、`system-confidence.ts:77`、`policy-calibrator.ts:94` |
| **Intent 分类器** | ✅ 在用 | `intent-classifier.ts:64`、`chat.ts:269` |
| **Context Boundary**（Worker 不碰原始数据） | ✅ 核心护栏，类型级强制 | `local-manager-runtime.ts:116-129` |
| **Gated Delegation** | ✅ 演进为 G0-G4 | `llm-native-router.ts:120-179` |
| **Manager-Worker 隔离** | ✅ 架构核心 | `trustos-manager-worker-trust-architecture.md` |
| 测试/验证体系 | ✅ 演进为 `npm run verify:trust`（205 断言） | `package.json` |

---

## 6. 结论与建议

### 6.1 总体判断

方向演变是**叠加式**而非**推翻式**：路由、Context Boundary、Gated Delegation 都保留了，
新增了可信闭环与主权数据层。这是健康的演进。

但存在两类问题：
1. **能力退化**：Delegation Archive 的 O(1) 检索价值丧失（只写不读）
2. **清理滞后**：13 个前端孤儿组件、若干 legacy 类与 deprecated 导出仍留在文件中

### 6.2 建议（按性价比）

| 优先级 | 事项 | 说明 |
|---|---|---|
| **P1** | **决策 `delegation_archive` 去留** | 要么恢复"查档案库"能力（重新兑现 O(1) token 价值），要么停止写入并归档表。**当前只写不读是最差状态**——付出写入成本却无收益 |
| **P1** | 清理 13 个前端孤儿组件 | 尤其 `LearningPanel`/`TokenSankey`（曾集成后被移除） |
| **P2** | 移除或标注 `LocalArchiveStore` 等 legacy 导出 | 减少双轨困惑 |
| **P2** | 评估 `slow-worker-loop` 的 legacy 双轨是否可收口 | Cycle Runtime 稳定后可考虑移除 legacy 分支 |
| **P3** | 清理 `mcp-passthrough-forwarder.ts` 的 deprecated 导出 | MCP 未接入主链路 |

### 6.3 值得注意的一点

`src/types/task.ts:214` 的注释坦承：
> `@deprecated Use satisfaction_rate. This field previously reflected **fake** routing_correct data.`

这说明项目早期有个**造假的路由准确率指标**，后来被诚实替换。
这类坦承记录是项目的优点——**发现问题是修复的前提**，且留下了痕迹便于追溯。

---

## 7. 附录：本次审计的史料清单

| 来源 | 内容 |
|---|---|
| `20260416102442/.workbuddy/memory/2026-04-16.md` ~ `2026-05-08.md` | 逐日开发日志 |
| `20260416102442/PHASE-0-5-AUDIT-2026-04-29.md` | 阶段审计 |
| `20260416102442/delegate_fix_report_20260504.md` | 委托修复报告 |
| `20260507230038/HANDOFF.md` + 逐日日志 05-08~05-18 | 交接与日志 |
| `20260526092546/.workbuddy/memory/MEMORY.md` | S84P–S97P Sprint 状态 |
| 当前代码库搜索 | 交叉验证（调用方、deprecated 标记、孤儿组件） |
