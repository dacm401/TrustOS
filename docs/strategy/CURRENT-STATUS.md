# TrustOS 当前状态（会话恢复卡片）

> **用途**：新会话/上下文压缩后，**先读这一个文件**即可恢复工作上下文。
> 详细历史见 `TRST-execution-log.md`（3828+ 行，按时间追加）。
> **维护约定**：每完成一批重要工作，必须更新本文件（见文末「维护约定」）。

*最后更新：2026-08-29*

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 分支 | `feature/trst-3-private-beta-readiness` |
| 定位 | 个人 PC 操作系统（本地 OS，单用户）；先服务愿自己跑容器的极客 |
| 运行时 | Docker Compose 全栈（frontend :3000 / backend :3001 / gateway :8787 / postgres / redis / minio / prometheus） |
| 登录 | `admin` / `changeme`（`.env` 的 `AUTH_USERS`） |
| LLM 上游 | SiliconFlow `deepseek-ai/DeepSeek-V4-Flash` |

## 2. 最近 commit（时间倒序）

| Commit | 内容 |
|---|---|
| `2a88f0d` | docs: RFC-001 本地优先存储 + Memory 增量蒸馏设计（待拍板） |
| `9320976` | feat(egress): **ADR-001 护栏重述** — 本地优先存储 + 外发强制加工 |
| `b1380d2` | docs: 系统回顾文档更新（第二轮 P1-P2 完成） |
| `945ca73` | feat: 第二轮 P1-P2（Assessment 增强 / Bundle 签名 / 索引去 native） |
| `d339fa1` | fix(trust): P0-P2 架构断链修复（Event Backbone / 哈希链 / Gateway / Control / Audit） |
| `7e6a0cd` | docs: 系统全景回顾与主流 Agent 对比分析 |
| `a7929b7` | chore: 前端防御改进（EvidencePanel 重试 + 网关离线守卫） |
| `1e01a83` | fix: 聊天 401（补 Authorization 头）+ API fallback 端口 3002→3001 |
| `1cbcc44` | fix: 首页 client-side exception（补 QueryClientProvider） |

⚠️ **全部未 push**（github.com:443 网络阻断），待网络恢复后一并推送。

## 3. 已完成的关键工作（2026-08-26 ~ 08-29）

### 3.1 稳定性修复（用户报告驱动）
- **首页 client-side exception**（`Application error`）
  根因：`app/providers.tsx` 缺 `QueryClientProvider`，5F2 的 `React.lazy` 视图调 `useQuery` 时整页崩溃。
  修复：在 Providers 包裹 `QueryClientProviderWrapper`。
- **聊天返回"处理您的请求时出现了问题"**
  根因①：`docker-compose.yml` 硬写旧模型 `Qwen/Qwen2.5-*`，覆盖 `.env` 的 deepseek。
  根因②：`ChatInterface` 调 `/api/chat` **只带 `X-User-Id` 不带 `Authorization`** → 401。
  修复：模型改由 `.env` 控制；两个发送路径补 `Bearer` 头。

### 3.2 信任架构：P0-P2 断链修复（**系统回顾分析后发现**）
详见 `trst-system-review-and-competitive-analysis-2026-08-28.md` §6-§8。

| 断链 | 根因 | 结果 |
|---|---|---|
| Event Backbone 主后端写不进 | `initEventStore()` 仅被 Gateway 脚本调用，`src/index.ts` 从未调用 | ✅ enforcement 事件真实落盘 |
| Evidence 无哈希链 | 只有逐条哈希，无 `prev_hash` → **无法发现删除** | ✅ 加链 + 验证器，14/14 |
| Gateway 未部署 | compose 无该服务；且 `better-sqlite3` SIGSEGV（exit 139） | ✅ 部署 + 改**纯 JS 索引**消除 native 依赖 |
| Control 永不拦截 | ①`buildEngine` 传 `classifier=undefined` ②规则集受 `dlpEnabled` 控制默认空数组 | ✅ 规则真实命中，`can_block:true` |
| Audit UI 为 fixture | 渲染 4 个静态样例 | ✅ 接 `GET /v1/human-review` 真实数据 |
| Assessment 信号浅 | 12 信号全基于元数据 | ✅ 18 信号，含链完整性（**可检测删除**） |
| Evidence Bundle 仅前端 | 剪贴板导出，`signed:false` | ✅ 后端化 + HMAC 签名 + 验证端点 |

### 3.3 护栏重述（ADR-001，Boss 决策）
旧护栏「raw content 不落库」→ **新护栏**：
- **入**：本地优先，原始 prompt 存本机
- **出**：**发往云端必须加工**（已实现）
- 证据链仍仅哈希

已实现「出」侧：`src/services/egress/egress-processor.ts`

### 3.4 主权数据层 Phase 1 实施（RFC-001，2026-08-29）

**B-0 数据层**：
- migration `032_sovereign_conversation_turns.sql`：`conversation_turns` 表
  （session / turn_index / role / content / content_hash / sensitivity / archive_id）
- `src/db/repositories/conversation-turn.ts`：
  - 密钥**永不落库**（命中即丢弃，不存脱敏副本——脱敏的主权记录是损坏的记录）
  - `recordAsync` 异步写入，绝不阻塞响应
  - 预留 Phase 2 归档字段（`archive_id` / `listArchivable` / `markArchived`）
- 聊天管线接入：用户原始消息落库（热层明文，按 ADR-002 冷热分离决策）

**B-1 L0 规则蒸馏**（**零 LLM 调用**）：
- `src/services/memory/distiller.ts`：11 条显式信号规则
  （记住 / 以后都 / 我喜欢 / 用X不要用Y / 我们决定 / 不要 / 必须 / 我是 + 英文 4 条）
- 精确率优先：普通对话**保持沉默**（宁可漏，不可错——错误记忆会误导后续每一轮）
- 每条带 `rule:` 与 `turn:` 标签，**provenance 可追溯到来源会话**
- 密钥类内容拒绝蒸馏

**实施中发现并修复的两个质量问题**：
1. **规则重叠导致冗余记忆**：一条消息被 3 条规则命中，生成 3 条表达同一事实的记忆
   → 实现 `suppressOverlaps()`：按 evidence 长度贪心选择，保留最完整匹配
2. **跨句贪婪合并**：`(.{2,120})` 跨越句号，把两个独立信号合并成一条
   → 捕获组改为句边界感知 `[^。！？；;!?\n]`

**端到端实测**：
- 「记住我的测试框架是 Vitest」→ `auto_learn | fact | {explicit,rule:remember,turn:sovereign-…}`
- 「以后都用 pnpm 不要再用 npm」→ 1 条（修复前 3 条）

### 3.4b Memory 注入闭环（存→用，2026-08-29）

蒸馏只解决「存」，注入解决「用」——闭环后主权数据才真正产生价值。

**实现** `src/services/memory/injector.ts`：
- **三层注入**：always（指令/约束、高权重偏好）/ on_relevance（事实、技能）/ 会话层（现有历史机制）
- **规则驱动**：`DEFAULT_RULES` 可按 category / importance / confidence / 阈值配置
- **预算硬截断**：8k 本地 Manager 默认总 500 token（常驻 ≤200，fact top-k 3）
  → `TRUSTOS_MEMORY_INJECT_MAX_TOKENS` 可调，换模型无需改代码
- **接收方分档**：`local` 不加工（数据不出本机）/ `remote` 必须加工
- **注入可见**：日志记录选中条数、token、方法、每条的规则名与相关度

**架构决策——不重复造轮子**：
现有 `retrieveMemoriesHybrid`（向量+关键词混合、DB 降级）检索能力更强，
故 injector **复用其检索结果**（`candidates` 参数），自己只负责
**选择 / 排序 / 预算 / 渲染**。职责分离，两套逻辑不并存。

**实施中发现并修复的两个真实问题**：
1. **中文关键词匹配失效**：中文无空格，「测试框架」整句被当作一个 token，
   与「测试框架是 Vitest」匹配得 0 分。改为 **CJK bigram 切分**（无需分词库）。
2. **相关度失去区分度**：混合检索 score 未归一化，clamp 后全部变 1.00，
   导致 `on_relevance` 门控形同虚设（全部通过）。
   增加「无区分度时回退关键词重算」逻辑。

**端到端实测**（问「我的测试怎么跑？」）：
```
[memory-inject] selected=5/5 tokens≈56/500 method=vector truncated=false
  · [relevant_facts]     fact        rel=0.50  ← 相关，命中注入
  · [global_constraints] instruction rel=0.00  ← 不相关但仍注入（约束必须每轮可见）
```

### 3.5 注入可观测性（为「观察后调参」做准备）

新增 Prometheus 指标（`src/metrics/prometheus.ts`），让注入规则可以
**基于数据调优**，而非凭感觉：

| 指标 | 用途 |
|---|---|
| `memory_injections_total{target}` | 注入次数 |
| `memory_injected_entries_total{rule}` | 每条规则贡献的条目数 → 看哪些规则在起作用 |
| `memory_inject_tokens` | 单轮 token 消耗 → 看预算是否合适 |
| `memory_inject_truncated_total` | 超预算次数 → 频繁说明预算太紧 |
| `memory_inject_method_total{method}` | vector / keyword → keyword 占比高说明向量区分度不足 |
| `sovereign_turns_stored_total{result}` | 落库 / 因密钥跳过 / 空内容跳过 |
| `memory_distilled_entries_total{rule}` | 蒸馏命中哪些规则 |

**首次基线（2026-08-29，2 轮对话）**：
```
memory_injections_total{target="local"} 2
memory_injected_entries_total{rule="relevant_facts"} 2
memory_injected_entries_total{rule="global_constraints"} 4
memory_inject_tokens 32                        ← 仅占预算 500 的 6.4%
memory_inject_method_total{method="keyword"} 2  ← 回退到关键词
sovereign_turns_stored_total{result="stored"} 2
memory_distilled_entries_total{rule="remember"} 1
```

**初步洞察（待更多数据验证，不急于调参）**：
1. token 仅用 32/500 → 保守默认**绰绰有余**，可考虑放宽 top-k 或降低阈值
2. `method=keyword` → 向量 score 区分度不足而回退，是后续优化点

**调参入口**：`TRUSTOS_MEMORY_INJECT_MAX_TOKENS`（预算，默认 500），无需改代码。
**建议积累数天真实对话后再调**，避免过早优化。

### 3.6 威胁模型同步（2026-08-29）

`TRST-threat-model-v0.1.md` 已同步 ADR-001/002：
- 头部加护栏变更说明（新资产需防御 + 外发从「观察」升级为「强制」）
- §3 新增威胁「**主权数据静态存储被攻破**」（部分覆盖，附缓解措施）
- §4 非声明项新增 3 条诚实边界：
  整机被控无解 / 密文不可检索 / 归档口令丢失不可恢复

### 3.7 开发考古（2026-03 → 2026-08，2026-08-29）

产出 `docs/strategy/trst-archaeology-2026-03-to-08.md`，追溯方向演变并审计遗留：

**方向演变五阶段**：
起步(03) → **路由性能产品** SmartRouter Pro(04) → 工程化与 Context Boundary(05)
→ **可信 AI 操作系统** TrustOS(06-07) → **个人 PC OS + 数据主权**(08)

**被改掉的原优点（重要）**：
- 🚨 **Delegation Archive 的 O(1) token 检索模型名存实亡**——
  04-16 O-005 设计「新任务开新对话、查档案库」，
  现 `DelegationArchiveRepo` 的**读方法无任何调用方**，表**只写不读**：
  付出写入成本却无读取收益，是最差状态
- `/chat-result` 轮询被 SSE 取代（合理演进）
- Phase 5 `LocalArchiveStore` 降级为 legacy 兼容

**废而未除的代码**：
- **13 个前端孤儿组件**未被 import（`ActionBar`/`CodeBlock`/`PreviewPane`/
  `AdminPanel`/`BetaPanel`/`DecisionTimeline`/`DelegationLogsPanel`/
  `GrowthChart`/`LearningPanel`/`StatsCards`/`TokenSankey`/`CommandPalette` 等）
  其中 `LearningPanel`/`TokenSankey` 在 05-09 日志中记录为「已集成」，
  说明**集成后被回退、文件却留下**
- 多处 `@deprecated` 仍导出（`LocalArchiveStore`、MCP forwarder 三函数、
  `routing_correct` 字段）
- `slow-worker-loop.ts` 大量 legacy 双轨分支并存

**保留完好**：KB-1 知识边界信号（gating 链路活跃）、Intent 分类器、
Context Boundary、Gated Delegation G0-G4、Manager-Worker 隔离

**待决**：`delegation_archive` 去留（恢复查档案能力 or 停止写入）

### 3.8 数据主权原则（ADR-002，Boss 决策 2026-08-29）

**核心认知**（Boss 指出，此前被算错）：
- 加工解决「**少泄露**」，留存解决「**谁拥有**」
- 只加工不留存 ⇒ **唯一拥有完整数据的是云端** ⇒ 自主权是空话
- 风险不对称：云端是**确定性**泄露且完全失控；本地是可能性泄露且完全可控
- 差异不在"更安全"，而在**主权归属**：同等便利，数据在你手上

**分层主权模型**：L1 原始意图（本地/加密/从不外发）→ L2 加工产物（唯一外发层）
→ L3 模型输出（回落本地）→ L4 云端副本（已知损失，仅含 L2）

**演进方向**：Phase 1 主权数据层 → Phase 2 主权数据包（可打包迁移）
→ Phase 3 本地模型读取（**先 RAG 后微调**）→ Phase 4 自主闭环（远期预留）

**诚实接受的局限**：本地泄露的浓缩性风险、"机器被控"应用层无解、
加密与检索的矛盾（采用索引明文+内容加密，无法消除只能管理）、本地模型能力有限

## 4. 当前待办

| 状态 | 事项 |
|---|---|
| 🔴 **待 Boss 拍板** | **RFC-001 Phase 1 实施**（5 项：加密方案 / L2 是否做 / 保留期 / 低置信度处理 / 是否回溯历史）。Phase 2-3 仅确认方向，现只需拍板 Phase 1 |
| 🟡 待网络恢复 | push 全部本地 commit（github.com:443 阻断） |
| 🟢 可随时做 | 同步 `TRST-0` 文档中的旧护栏表述（已被 ADR-001/002 变更，原文未同步） |

## 5. 验证入口

```bash
npm run verify:trust
```

| 组 | 断言数 | 覆盖 |
|---|---|---|
| `verify:chain` | 14 | 哈希链（防篡改/**防删除**/重启恢复） |
| `verify:egress` | 39 | 外发加工（脱敏/裁剪/统计安全） |
| `verify:index` | 39 | 纯 JS 索引契约 |
| `verify:bundle` | 26 | Evidence Bundle 隐私 + 签名 |
| `verify:assess` | 11 | Assessment 新信号 |
| `verify:egress-fp` | 6 | 零误伤 |
| **合计** | **135** | |

## 6. 关键文档索引

| 文档 | 用途 |
|---|---|
| **`CURRENT-STATUS.md`**（本文件） | 会话恢复入口 |
| `TRST-execution-log.md` | 完整时间线（3828+ 行） |
| `ADR-001-local-first-egress-processing.md` | 护栏重述决策（本地存 + 外发加工） |
| `ADR-002-data-sovereignty-principle.md` | **数据主权原则**（为什么必须本地留存；分层主权模型 L1-L4） |
| `RFC-001-local-memory-distillation.md` | 主权数据战略 + Memory 蒸馏 + 四阶段演进路线（待拍板 Phase 1） |
| `trst-system-review-and-competitive-analysis-2026-08-28.md` | 系统全景 + 竞品对比 + 诚实评估 |
| `TRST-0-trustos-architecture-thesis.md` | 战略基线（⚠️ 护栏表述已被 ADR-001 变更，待同步） |
| `TRST-5-charter-draft.md` | TRST-5 章程 |

## 7. 环境注意事项（踩过的坑）

| 坑 | 说明 |
|---|---|
| PowerShell 编码（**高危**） | `Set-Content` / `Add-Content -Encoding utf8` 在 PS 5.1 会造成**双重编码乱码**（尤其含中文时），且会真实损坏文件。改用 `[System.IO.File]::WriteAllText/AppendAllText($p, $t, [System.Text.UTF8Encoding]::new($false))` |
| PowerShell 编码（BOM） | 即便用对 API，`Set-Content` 也可能写 BOM，导致签名验证**假失败**；验证请用 node 脚本 |
| PowerShell 多行字符串 | 含中文的多行 commit message 会解析失败；改用 `git commit -F <file>` |
| 中文 commit message | 终端回显乱码属正常（git 内存储正确），不必据此判断失败 |
| `NEXT_PUBLIC_*` | 只在 **build 阶段**固化；compose 的 `environment:` 对运行时无效，必须用 `build.args` |
| `better-sqlite3` | `npm install --ignore-scripts` 会跳过 prebuild → `require()` 时 SIGSEGV（exit 139，try/catch 无法捕获） |
| Windows curl | IPv6 怪癖导致误报 UNREACHABLE；用 `netstat` 或 `Invoke-WebRequest` 确认 |
| 双进程写同一 JSONL | 会交错损坏哈希链；遵循 single-writer，每个 writer 独立日志文件 |

---

## 维护约定

**何时更新本文件**：
1. 完成一批 commit 后
2. 做出架构/护栏决策后
3. 发现环境坑后（写入 §7）
4. 待办状态变化时（§4）

**原则**：
- 文档是**跨会话的持久记忆**——上下文会被压缩，文档不会
- 记录**为什么**（决策依据），不只是**做了什么**
- 诚实记录坏处与局限，不制造虚假安全感
