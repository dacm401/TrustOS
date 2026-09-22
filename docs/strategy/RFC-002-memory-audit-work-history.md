# RFC-002：Memory 审计与工作历史面 —— 原始意图 / Manager 加工 / 派发任务 / Worker 结果 可查可审计

> **状态**：ACCEPTED — 实施已授权（Boss 2026-09-20 按 §10 建议全通过）
> **日期**：2026-09-20
> **前置**：`RFC-001-local-memory-distillation.md`（主权数据层 Phase 1，已签核实施并验证通过）/ `ADR-001-local-first-egress-processing.md`（已 ACCEPTED）
> **决策者**：Boss

---

## 0. 愿景

> **用户能查到自己全部的工作历史，并审计「我对 Manager 说了什么 → Manager 把它加工成了什么 → 派给 Worker 的到底是什么任务 → Worker 返回了什么」。
> 数据始终在本机，可检索、可溯源、可验证未被篡改。**

一句话概括当前阶段：

**RFC-001 把"用户原始意图"落进了本机（conversation_turns）并验证通过；
本 RFC 把已经分散写入库里的 Manager 加工记录、派发任务、Worker 结果，
串成一条用户可查、可审计、可全文检索的统一时间线——并在普通委托流补齐 Manager 加工 prompt 的留痕。**

---

## 1. 为什么做

### 1.1 首要动机：Memory 的真实主价值是"跨 Manager→Worker 加工边界的保真"（架构动机）

之前对 Memory 的理解偏窄（只看到"粘性钩子"）。经与 Boss 对齐，Memory 的**架构主价值**是：

- 链路：用户 prompt → **Manager 先加工**（理解/拆解/重组）→ 给 **Worker** 派活（brief）。
- "加工"是信息损耗高发点：Manager 可能过度解读、丢细节、用自己的复述覆盖用户原意；且 Manager 上下文窗口有限、易失。
- 所以 Memory 在**派活瞬间对历史 prompt 做召回**，把与当前任务相关的用户原话拉回作 grounding，确保 Worker 执行的是"用户真正要的"，而非 Manager 走样版本。
- 这是**准确性/保真度保障**，不是 UX 糖。

### 1.2 次要动机（但 Boss 明确要的）：用户可审计 = TrustOS 的差异化

Boss 2026-09-20 明确：**Memory 也要给用户看**——用户能查自己的工作历史，能审计 Manager 的 prompt 与派发的任务。

这正落在 TrustOS 主线（Audit / Evidence / 可验证）上：
- 把 Manager 从黑盒变成可审查；
- 用户可确认"我的话有没有被 Manager 改歪、派出去的任务是不是我想要的"。

### 1.3 现状：数据大多已在写，但"露 + 串 + 查"三缺（核查证据）

2026-09-20 代码核查（只读）结论——审计链所需的**数据在运行时大多已落库**，真正缺的是"统一用户可见的查询/审计面"和少量接线：

| 数据表 | schema | 运行时真写入？ | 读 API | 前端 UI |
|---|---|---|---|---|
| `conversation_turns`（用户原文） | ✅ | ✅ `chat.ts:182`（user）/`:700`/`:1044`（assistant），受 `TRUSTOS_SOVEREIGN_STORE!=="0"` 门控 | ✅ `/v1/sessions/:id/turns`、`/recent`、`/:id/summary` | ❌ 无专属 UI |
| `manager_messages`（Manager 加工 prompt） | ✅ | ⚠️ **仅用户主动用"Manager 对话"功能时写**（`conversation-service.ts:166`）；普通委托流 `llm-native-router.ts` **不写** | ✅ `/v1/manager-conversations` | ✅ ManagerView |
| `task_commands`（派发任务 brief） | ✅ | ✅ `llm-native-router.ts:2163` 真写，`payload_json`=下发 brief | ❌ 无直接 GET | ❌ 仅经 `task_archives` 间接 |
| `task_worker_results`（Worker 结果） | ✅ | ✅ `slow-worker-loop.ts:465,1031` + `execute-worker-loop.ts:144` 真写 | ❌ 无直接 GET | ❌ 仅经 `task_archives` 间接 |
| `task_archives`（任务档案） | ✅ | ✅ 含 `original_message`/`delegation_prompt`/`task_brief`/`manager_decision` | ✅ 多路由 | ✅ TasksView/ArchiveView |
| `delegation_archive` | ✅ | ❌ **死表**：repo 在 `delegation.ts:134` 但运行时从未调用 | ❌ | ❌ |

关键判断：
- **A（保真召回）的召回源 `conversation_turns` 已就绪**，相似度引擎（replay 的）可复用，只差"派活时调一次召回进 brief"。
- **C（用户可查+审计）的数据齐全**，但①`task_commands`/`task_worker_results` 无读 API；②没有任何把"原文→Manager prompt→派发任务→结果"串成时间线、支持全文搜历史的**统一面**；③普通委托流的 Manager 加工 prompt 没持久化；④`delegation_archive` 是死表该清理。

### 1.4 RFC-001 已铺好 L1 地基

RFC-001 Phase 1（已签核、185 项断言全绿）交付：`conversation_turns` 原文层 + 敏感度门 + 归档/备份/重放。本 RFC 在其上构建"审计/查询面"，不重复造 L1。

---

## 2. Memory 的三价值统一模型

一份"用户工作记忆"同时服务三种价值（同一份数据的三个视角）：

- **A. 保真（架构主价值）**：派活瞬间对历史 prompt 召回，给 worker brief 做 grounding，对冲 Manager 加工的信息损耗。
- **B. 粘性 / 用户画像（Boss 定，次要产出）**：由 RFC-001 的蒸馏层（`memory_entries`/`identity_memories`/`behavioral_memories`）承载，本 RFC 不重复。
- **C. 用户可见的审计 / 透明（Boss 2026-09-20 加）**：工作历史可查 + 审计 Manager prompt 与派发任务。

三者共享同一份持久化数据；差异只在"谁消费、何时消费"：
- A 在**派活瞬间**由 context-curation 层自动消费（召回 → curation → 进 brief）；
- C 在**用户主动查询**时由统一查询面消费（时间线 + 全文检索）；
- B 是 A/C 的顺带蒸馏产物。

---

## 3. 演进路线（Phase 0 → 3）

- **Phase 0 — 清理与最小接线**：处置死表 `delegation_archive`；普通委托流补 Manager 加工 prompt 留痕。
- **Phase 1 — 后端读 API（为 UI 铺路）**：暴露 `task_commands` / `task_worker_results` 读 API；新增统一 `work-history` 查询面（跨表聚合 + 全文检索）；审计事件接入 Event Backbone 哈希链。
- **Phase 2 — 前端统一审计/工作历史视图**：时间线串起 原文→Manager prompt→派发任务→结果；全文搜历史；接 `/sessions/:id/turns` 做"跳回原对话"。
- **Phase 3 — A 保真召回（价值最高、风险最大，可后置）**：派活时查 `conversation_turns` 相似历史，curation 后进 brief。

---

## 4. 主要策略

### 策略一：审计链同源单写，处置死表 `delegation_archive`

`delegation_archive` 与 `task_archives`/`task_commands` 表达同一类"派发"信息却双写且前者死掉，造成歧义。
**推荐：废弃 `delegation_archive`**（加 Migration 034 标记 deprecated / 删除 schema 与 repo 引用），统一以 `task_archives` + `task_commands` + `task_worker_results` 为唯一审计数据源。

### 策略二：普通委托流补 Manager 加工 prompt 留痕

在 `llm-native-router.ts` 派发处（紧邻 `TaskCommandRepo.create` @ :2163）追加 `ManagerMessageRepo.create({ role:'manager', content:<加工后的 prompt/brief>, conversation_id:<session_id>, related_session_id:<session_id> })`。
这样"Manager 把我的话改成了什么"在普通聊天里也留痕，而非只在专用"Manager 对话"功能里（现 `conversation-service.ts:166`）。

### 策略三：统一查询面 `work-history`（露 + 串 + 查）

新增 `GET /v1/work-history?q=&session_id=&from=&to=&limit=`：
- 按 `user_id`（强制隔离）跨 `conversation_turns`（type=message）、`manager_messages`（type=manager_prompt）、`task_commands`（type=dispatch，含 `payload_json`）、`task_worker_results`（type=result，含 `result_json`）**按时间合并**返回；
- 每条带 `session_id`/`task_id`/`command_id` 钻取链接；
- 全文检索（`q`）用 Postgres `ILIKE`（MVP，零扩展；pgvector 在测试环境禁用）——见 §10 决策 5。

### 策略四：用户可见审计时间线（前端统一入口）

新增统一"工作历史 / 审计"视图（非把数据塞进 Memory 偏好页）：
- 时间线聚合上述四类条目；点开看 原文 → Manager 加工 → 派发 brief → Worker 结果 明细；
- 支持历史全文检索框；
- 复用现有 `TasksView`/`ArchiveView`/`ManagerView` 的钻取组件，但给统一入口；
- 接 RFC-001 已建 `GET /v1/sessions/:id/turns`，在记忆/任务上支持"跳回原始对话"。

### 策略五：保真召回（A）curation 后进 brief（Phase 3，后置）

派活时在 context-curation 层查 `conversation_turns` 相似历史（复用 replay 的 CJK bigram 相似度 + 时效门），**curation 后**注入 brief。
护栏：Worker 仍只收 curated brief，不收 raw history dump（ADR-001 + context-curation 不变量）。

### 策略六：tamper-evident 审计链（哈希链）

审计可信度靠"未被偷偷改写"。复用既有 Event Backbone（`events.jsonl`，哈希链）与 `task_archive_events`：
- 在 `task_commands` 插入、`task_worker_results` 插入时，各发一条 backbone 事件（`task_dispatch` / `worker_result`），使审计链落入既有哈希链；
- 不新造签名体系，`TRUSTOS_EVIDENCE_SIGNING_KEY` 缺失时如实返回 `signed:false`（沿用 TRST-0.3 tamper-evident 而非 tamper-proof）。

---

## 5. 好处

- **差异化兑现**：把 Manager 从黑盒变可审计，是竞品（云端大模型 App）做不到的"数据在你手上 + 可验证"。
- **保真（A）**：派活召回降低 Manager 加工信息损耗，Worker 命中用户真实意图。
- **可查（C）**：用户全文搜自己的历史工作，跨会话连续。
- **数据已具备**：不重写存储，只在"露+串+查"上增量，风险低、性价比高。
- **复用**：event backbone 哈希链、`/sessions/:id/turns`、replay 相似度引擎、现有 TasksView 组件均可复用。

---

## 6. 坏处与代价（诚实列出）

- **存储增长**：`manager_messages` 普通流补写 + 历史全文检索索引，会增加写入量与磁盘占用（本地单用户可接受）。
- **查询面复杂度**：跨四表合并+钻取，UI 状态管理变复杂；需控制时间线渲染性能（分页/虚拟列表）。
- **A 召回的误召回风险**：相似历史若含过期事实，可能误导 Worker（靠时效门 + curation 缓解，仍非零风险）→ 故 Phase 3 后置。
- **死表清理的回归风险**：删 `delegation_archive` 需确认无隐藏读取（核查显示仅 `archive-replay.ts:84` `findSimilar` 内部读，且因无写入实际返回空）→ 安全，但删除前加 grep 门禁。
- **不解决多用户**：Boss 2026-08-24 已定本机单用户，本 RFC 仅 `user_id` 隔离，不做 RBAC/多租户。

---

## 7. 怎么做（详细设计）

### 阶段 0：清理 + Manager 加工留痕
- 加 `src/db/migrations/034_drop_dead_delegation_archive.sql`（或标记 deprecated），删除 `delegation_archive` schema、`DelegationArchiveRepo` 引用、`archive-replay.ts:84` 死读；加 grep 门禁确认无残留。
- `llm-native-router.ts` 派发处（@ :2163 附近）追加 `ManagerMessageRepo.create({ role:'manager', content: <加工 brief>, conversation_id: session_id, related_session_id: session_id })`。
- **DoD**：`delegation_archive` 零引用；普通聊天后在 `manager_messages` 可见一条 `role='manager'` 记录且 `related_session_id` 正确；`tsc` 绿。

### 阶段 1：后端读 API + 统一查询面
- `GET /v1/tasks/:id/commands` → `task_commands`（`payload_json` = 派发 brief）+ 状态；`user_id` 隔离。
- `GET /v1/tasks/:id/worker-results` → `task_worker_results`（`result_json`/`summary`）；`user_id` 隔离。
- `GET /v1/work-history` → 四表按 `user_id` 合并 + `q` 全文（`ILIKE`）+ `session_id`/`from`/`to`/`limit` 过滤，返回带钻取链接的统一 feed。
- 在 `TaskCommandRepo.create` / `TaskWorkerResultRepo.create` 插入处各发一条 Event Backbone 事件（`task_dispatch` / `worker_result`）。
- **DoD**：三路由 `tsc` 绿 + 单测覆盖 `user_id` 隔离（越权返回空）；`work-history` 全文检索命中；backbone 事件落链。

### 阶段 2：前端统一审计/工作历史视图
- 新增 `components/views/WorkHistoryView.tsx`：时间线（message/manager_prompt/dispatch/result 四类卡片）+ 顶部全文检索框 + 会话筛选。
- 钻取：`dispatch` 卡片展开看 `payload_json`；`result` 卡片看 `result_json`/`summary`；`message` 卡片经 `/sessions/:id/turns` 跳回原对话。
- 复用 `TasksView`/`ArchiveView` 现有组件，统一入口置于侧栏。
- **DoD**：能在页面看到 原文→Manager prompt→派发→结果 完整链；全文搜历史命中；点记忆跳回原文；前端 `tsc` 绿。

### 阶段 3（可选，后置）：A 保真召回
- context-curation 层在派活前查 `conversation_turns` 相似历史（复用 replay 相似度 + 时效门），curation 后注入 brief。
- **DoD**：派活 brief 含相关历史 grounding；Worker 仍只收 curated brief（不变量回归测试通过）。

---

## 8. 风险登记

| 风险 | 等级 | 缓解 |
|---|---|---|
| 删 `delegation_archive` 触发隐藏读取 | 低 | grep 门禁 + 核查已知仅死读 |
| `work-history` 跨表合并性能 | 中 | 分页 + `created_at` 索引 + `user_id` 强制过滤 |
| A 召回误带过期事实 | 中 | 时效门 + curation；故后置（Phase 3） |
| Manager 加工 prompt 暴露敏感 | 低 | 沿用 RFC-001 敏感度门（local 全返回 / 不外发） |
| 审计链被篡改 | 低 | Event Backbone 哈希链（tamper-evident） |

---

## 9. 验证方式

- 扩展 `npm run verify:*` 套件（沿用 RFC-001 风格，纯逻辑可离线、DB 级实时跑）：
  - `verify:memgate`（已有，13/0）：确认召回/敏感度门仍绿。
  - `verify:auditapi`：三新路由返回正确 `payload_json`/`result_json` 且 `user_id` 隔离（越权空）。
  - `verify:workhistory`：四表合并 feed 含 原文→Manager prompt→派发→结果；`q` 全文命中；钻取链接存在。
  - `verify:managerprompt`：普通委托流后 `manager_messages` 出现 `role='manager'` 且 `related_session_id` 正确。
- 后端 `tsc --noEmit` 全绿；前端 `tsc` 全绿；既有 RFC-001 验证套件（185 断言）不回归。

---

## 10. 待 Boss 拍板

> **Boss 拍板 2026-09-20：§10.1–10.5 全部采用推荐项。**

### 10.1 死表 `delegation_archive` 处置
- **(推荐) 废弃并删除**（统一数据源到 task_archives/task_commands/task_worker_results）
- 或：接回写入（与 task_archives 重复，不推荐）

### 10.2 Phase 3（A 保真召回）是否本轮做
- **(推荐) 后置**：先交付 Phase 0–2（审计/查询面），A 召回单独评估
- 或：本轮一并做

### 10.3 统一面入口形态
- **(推荐) 新增独立 WorkHistoryView**（与 Memory 偏好页分离，语义清晰）
- 或：扩展现有 Archive/Memory 页

### 10.4 审计链是否接 Event Backbone 哈希链
- **(推荐) 接**：task_dispatch / worker_result 发 backbone 事件，复用既有哈希链
- 或：暂不做（仅 DB 记录，tamper-evident 后置）

### 10.5 全文检索实现（pgvector 在测试环境禁用）
- **(推荐) Postgres `ILIKE`**（MVP，零扩展）
- 或：启用 `tsvector` GIN 索引（仍内置、无扩展，但需迁移建索引）
- 或：启用 pgvector（需环境支持，不推荐）

---

## 11. 不做的事（明确边界）

- 不做多租户 / RBAC（本机单用户，Boss 2026-08-24 定）。
- 不新增外部依赖（复用既有 repo / event backbone / replay 引擎）。
- 不改变"Worker 只收 curated brief"不变量（ADR-001 + context-curation）。
- 不重写 L1 存储（RFC-001 已交付，本 RFC 仅增量"露+串+查"）。
- 不做 Phase 3 之外的"自主闭环 / 本地模型读取"（属 RFC-001 Phase 3/4，不在本 RFC 范围）。
