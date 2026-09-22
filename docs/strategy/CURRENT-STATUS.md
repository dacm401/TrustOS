# TrustOS 当前状态（会话恢复卡片）

> **用途**：新会话/上下文压缩后，**先读这一个文件**即可恢复工作上下文。
> 详细历史见 `TRST-execution-log.md`（3828+ 行，按时间追加）。
> **维护约定**：每完成一批重要工作，必须更新本文件（见文末「维护约定」）。

*最后更新：2026-09-22*

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

### 3.8 P0 两项已实施（2026-08-30，按 PLAN-P0 执行）

**① 助手回复落库**（补齐 Q/A 配对）：
- `ConversationTurnRepo.recordAssistant()` —— 密钥过滤同用户消息、
  空内容跳过、**content_hash 去重**（流式/非流式路径重叠时不重复写）
- 接线：`chat.ts` 非流式单一插入点覆盖 3 个 return（必须在 null 检查之后）；
  流式在 SSE `result` 事件落库（**委托结果也走 SSE**，无需在 worker 单独处理）
- 端到端实测：
  ```
  turn_index=0 | user      | 用一句话解释什么是哈希表
  turn_index=1 | assistant | 哈希表是一种通过哈希函数将键映射到数组下标…
  ```

**② 备份/恢复**（没有备份的主权不是主权）：
- `src/services/sovereign/backup.ts` —— 快照 schema v1 + SHA-256 校验和 +
  可选加密（scrypt + AES-256-GCM）+ upsert 幂等恢复 + dryRun
- 排除 `embedding`（派生数据，写入时异步再生成，避免大向量过 JSON）
- CLI：`npm run backup:create` / `backup:restore`
- 实测：导出 24 turns + 14 memories；明文/加密均跨进程往返成功；
  错误口令明确报错（AES-GCM 认证失败），无静默降级

**实施中发现并修复的真实 bug（重要）**：
> **checksum 跨进程不一致** —— pg 驱动把 `created_at` 等返回为 **Date 对象**，
> 而 `canonicalize` 把 Date 当普通 object（`Object.entries(Date)` 为空 → 序列化成 `{}`）；
> 但写入文件后是 ISO **字符串**。两者哈希不同 → **导出的快照永远无法恢复**。
>
> 单进程 round-trip 测试**抓不到**（数据未经过 JSON 往返）。
> 修复：在 `computeChecksum` **内部**做 JSON 规范化（修复根因，
> 而非要求每个调用方记得先往返）；并补跨进程回归测试锁定。

**验证**：`npm run verify:trust` **283 断言全绿**（11 组，新增 assistant 21 + backup 23）

### 3.9 P1 三项已实施（2026-08-30，按 PLAN-P1 执行）

**① Phase 2 主权数据包**（「能带走的数据才是你的」）：
- `src/services/sovereign/archive.ts` —— 复用 backup 的 checksum 与加密（不重复实现）
- 与备份的区别：归档**强制口令加密**、**热层移出**、**永不删除**；
  备份默认明文、不动热层、用于灾难恢复
- **只归档 `conversation_turns`，`memory_entries` 永不归档**
  （蒸馏物常驻，是「越来越懂你」的核心）
- CLI：`archive:create` / `archive:import` / `archive:status`
- 端到端实测（18/18）：归档后 turns **仍存在（只标记未删除）**、
  热层缩小、蒸馏物不受影响、导入可恢复

**② 治理能力**（从只读报告 → 可操作）：
- 后端：`GET /v1/memory?status=pending|active`、`POST /v1/memory/:id/confirm`、
  `GET /v1/memory/injections`
- **pending 真正阻断注入**（injector 加门控）—— 否则「待确认」形同虚设
- 待确认状态用 `status:pending` 标签承载，**不改表结构**
- 前端：待确认队列（确认/删除）+ provenance（规则/会话）+ 最近注入面板
- 端到端实测：create → pending → confirm(importance 2→3, 移除 tag) → active → delete ✅

**③ Evidence Bundle 持久化**：
- migration `033_evidence_bundles.sql` + schema.sql 同步
- API：`POST /bundle/save`、`GET /bundles`、`GET /bundles/:id`
- 实测：save 201(signed=true, chain_valid=true) → list → get → **verify 仍 valid=true**
  （JSONB 往返未破坏签名，复用了 backup 的 Date 规范化经验）

**修复的真实不一致**：`VALID_SOURCES` 缺 `auto_learn`（类型允许但 API 白名单没有，
此前靠 distiller 直写库绕过）—— 已补。

**验证**：`npm run verify:trust` **301 断言全绿**（12 组，新增 sovereign 18）

### 3.10 完成度评估与下一步规划（2026-08-30）

产出 `docs/strategy/TRST-maturity-assessment-and-next-steps-2026-08-30.md`

**综合完成度：约 65%**（六维度加权）

| 维度 | 完成度 |
|---|---|
| 核心产品功能 | 75% |
| 信任/可验证闭环 | 65%（四环节全通但都偏骨架） |
| 数据主权 | 45%（Phase 1 完成，Phase 2-4 未做） |
| 工程质量 | 70% |
| 文档与追溯 | 85% |
| 运维部署 | 50%（无备份/监控，未 push） |

**P0（底线，立即做）**：
1. 助手回复落库（主权数据只有"问"没有"答"）
2. 推送远程（当前仅存本地，单点风险）
3. **备份/恢复能力**——主权数据无备份 = 主权无保障

**P1**：Phase 2 主权数据包 / 治理 UI / Evidence 持久化

**探索方向**：
A. 本地模型做 Manager ⭐（Boss 已明确，建议**影子模式**先行：本地与云端同时决策只记录对比，用数据证明可行性）

**不建议现在做**：用主权数据微调模型——数据量不足，且错误记忆固化进权重后比 prompt 注入更难修复

### 3.9 数据主权原则（ADR-002，Boss 决策 2026-08-29）

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

### 3.11 功能审计清理（2026-09-18，agent-PM 执行）

按竞争力审计结论（"数据主权 + 可验证信任 + 架构隔离 + Memory 粘性"四条锚点之外皆为商品/过度建设）执行三优先级清理：

**① 修复"对话菜单看不出价值"**：`SessionSwitcher.tsx`（完整会话下拉，显示最后一句问题）此前是死代码、未挂接任何导航；已接入 `ChatInterface` 顶部，替换裸 `Session {id}…`。后端 `/v1/sessions/recent` 已返回 `last_user_message`，故下拉现在显示有意义预览，可切换/新建会话。

**② 清理死代码与重复后端（零功能损失）**：
- 删前端：`manager-workspace/*`（4 文件）、`lib/api_trst4x.ts`、`dashboard/GatewayStatusCard.tsx`、`dashboard/EvidenceReportPanel.tsx`、`app/dashboard/layout.tsx`
- 删后端路由：`/v1/beta`（后 Beta 废弃）、`/v1/manager-messages`、`/v1/manager`（与 manager-conversations 双轨重复）
- `app.ts` 同步移除挂载与导入
- **保留**（运维/功能价值，非"不必要"）：`admin` / `observability`（极客自部署可读）、`sessions`（现被 SessionSwitcher 使用）、`prompt-templates`（真实 CRUD，留待补 UI）

**③ 加固 auth（不锁登录）**：
- `/auth/token` 明文 `!==` 比较改为恒定时间比较（`crypto.timingSafeEqual`），防时序攻击
- 启动时若检测到 `admin:changeme` 默认弱口令，打印 `[AUTH-SEC]` 告警
- `beta-invite` 中间件为按需启用（`TRUSTOS_BETA_INVITE_REQUIRED=true` 才拦截），当前未启用、不阻断，保持不变

**验证**：前后端 `npx tsc --noEmit` 均 exit 0（无报错）。

**待办**：本次改动全部未提交（github.com:443 网络仍阻断），待网络恢复后一并提交。

### 3.12 极客友好部署 Quickstart（2026-09-18，agent-PM 自主）

补 Boss P0「5D 极客友好部署」缺口（此前 README 仅愿景、无极客跑起来指引）：
- 新增 `docs/geek-quickstart.md`：5 分钟从零到登录，含必改 `.env` 项、服务端口表、改码后重建命令、运维/局限。
- `.env.example` 模型默认值 `Qwen/Qwen2.5-72B-Instruct` → `deepseek-ai/DeepSeek-V4-Flash`（与后端/compose 一致，消除首跑模型不匹配坑），并补注释。
- `README.md` 顶部加一句指向 quickstart。
- 核查 `docker-compose.yml`：模型覆盖 bug 已修（模型经 `env_file:.env` 注入，未硬写）；`.env.example` / `.env.private-beta.example` 模板齐备；`docker/prometheus` 配置存在。
- 孤儿 `/v1/gateway/*` 端点：前端仅 1 处注释提及，已由前序 P0-P2 修复（Gateway 部署 + 纯 JS 索引）解决，非现存 bug。

**下一步 gate（需 Boss 拍板，超出自主权）**：**Memory 真实化（粘性钩子，RFC-001 待签核）** —— 这是当前最大差异化缺口，但落地需 charter 签核，未擅自实现。

### 3.13 RFC-001 Phase 1 核签与验证（2026-09-18，agent-PM）

Boss 签核「按建议全部通过」。实施时重大发现：**Phase 1 已在先前工作中完整实现，但未被记入本卡片**（文档纪律缺口，本次补录）。

已实现并接线（逐阶段核对）：
- **阶段0 主权层 `conversation_turns`**：迁移 `032_sovereign_conversation_turns.sql` + `src/db/repositories/conversation-turn.ts`（异步 `recordAsync`/`recordAssistantAsync`、`containsSecret`/`hashContent`、归档支持）；`src/db/schema.sql:757` 已含建表。
- **阶段1 L0 蒸馏**：`src/services/memory/distiller.ts`（记住/以后都/我喜欢/我们决定/不要/我叫 等规则 + 置信度分级 + 重叠抑制）+ `src/api/chat.ts:182-212` 已接线（`recordAsync` + `distilTurn`）。
- **阶段2 检索边界**：`src/services/memory/injector.ts` 只回蒸馏物、跳过 pending、`filterBySensitivity` 拦截非 public 出境；`src/services/llm-native-router.ts:443-444` 闭环注入（local/remote 双路径）。
- **阶段3 治理**：`/v1/memory` 的 `/governance`、`/:id/confirm`、`/injections`；前端 `MemoryGovernanceSurface` 接真实数据（非 fixture）。

**验证套件（全绿，含实时 DB 实测）**：
- `npm run verify:distill`（L0 蒸馏，纯逻辑）→ 39/0 ✅
- `npm run verify:inject`（注入引擎，纯逻辑）→ 37/0 ✅
- `npm run verify:memgate`（出境敏感度门，实时 DB）→ 13/0 ✅
- `npm run verify:assistant`（助手落库+去重，实时 DB）→ 21/0 ✅
- `npm run verify:sovereign`（归档：原文保留/冷层加密，实时 DB）→ 18/0 ✅
- `npm run verify:backup`（加密快照/防篡改，实时 DB）→ 23/0 ✅
- `npm run verify:replay`（归档重放/时效门，实时 DB）→ 34/0 ✅
- **合计 185 项断言全绿**。关键实证：`memgate` 实测 `remote blocked 4/5 by sensitivity`；`sovereign` 实测 `turns still exist after archive (marked, not deleted)` 且 `distilled memory NOT archived away`；`assistant` 实测 `identical second write is skipped (duplicate)`。

**本轮新增**：`GET /v1/sessions/:id/turns`（RFC 阶段2 本地原文回溯端点，`user_id` 隔离防越权），供治理 UI 从记忆跳回原始对话；后端 `tsc --noEmit` 通过（该端点本身无自动化 verify 脚本，前端跳转为后续小项）。

**环境说明**：本次为跑验证仅 `docker compose up -d postgres` 起数据库（不构建后端/前端）。要真正在对话里体验粘性记忆，需 `docker compose up -d` 起全栈。

### 3.14 Memory 价值模型纠偏 + 审计链核查 + RFC-002 起草（2026-09-20，agent-PM）

Boss 纠偏：Memory 真实主价值**不只是"粘性钩子"**，而是三重：
- **A. 保真（架构主价值）**：跨 Manager→Worker 加工边界——派活时召回历史 prompt 作 grounding，防 Manager 加工信息损耗。
- **B. 粘性/画像**：RFC-001 蒸馏层（`memory_entries`/`identity_memories`）的次要产出。
- **C. 用户可审计（Boss 2026-09-20 加）**：用户可查工作历史、审计 Manager 的 prompt 与派发的任务。

**代码核查（只读，`src/db/schema.sql` + 运行时调用点）**：审计链数据**大多已在写**，真正缺"露+串+查"：
| 表 | 运行时写入 | 读 API | 说明 |
|---|---|---|---|
| `conversation_turns` | ✅ `chat.ts:182/700/1044`（受 `TRUSTOS_SOVEREIGN_STORE` 门控） | ✅ `/sessions/:id/turns` | → A 召回源已就绪 |
| `task_commands` | ✅ `llm-native-router.ts:2163`（`payload_json`=派发 brief） | ❌ 无 | 写但不可查 |
| `task_worker_results` | ✅ `slow-worker-loop.ts:465,1031` + `execute-worker-loop.ts:144` | ❌ 无 | 写但不可查 |
| `task_archives` | ✅ | ✅ | 含 original/delegation_prompt/task_brief/manager_decision |
| `manager_messages` | ⚠️ 仅专用"Manager 对话"功能写（`conversation-service.ts:166`）；普通委托流不写 | ✅ | 普通流缺 Manager 留痕 |
| `delegation_archive` | ❌ **死表**（repo 有但运行时从未调用） | ❌ | 与 task_archives 重复，待清理 |

**缺口 = "露 + 串 + 查"**：`task_commands`/`task_worker_results` 无读 API；无统一审计时间线；普通流 Manager prompt 不留痕；`delegation_archive` 死表。

**交付**：`docs/strategy/RFC-002-memory-audit-work-history.md`（**ACCEPTED**，2026-09-20，五决策按建议拍板）。四阶段：
- **Phase 0**（✅ 完成）清死表 `delegation_archive`（DROP + 迁移 036 + `archive-replay` 重定向到 `task_archives`）+ 普通流 Manager 加工 prompt 留痕（`llm-native-router.ts`）。
- **Phase 1**（✅ 完成）读 API：`/v1/tasks/:id/commands`、`/v1/tasks/:id/worker-results`（user_id 归属校验）；统一 `GET /v1/work-history`（跨 4 表聚合 + `ILIKE` 全文）；`task_commands`/`task_worker_results` 落库接 Event Backbone 哈希链（`task_dispatch`/`worker_result`）。
- **Phase 2**（✅ 完成）前端统一审计视图：`WorkHistoryView`（时间线+全文搜索+按 type 着色）+ 侧栏「工作历史」入口；`fetchWorkHistory` 接入。
- **Phase 3**（后置，决策通过）A 保真召回——派活时从历史 prompt 召回 grounding，待单独立项。

**菜单收敛（2026-09-21，Boss 拍板「两者都合并」）**：原 9 个侧栏项收敛到 7 个，消除重复入口：
- **归档 → 工作历史**：`task_archives` 作为第 5 个源 `type="archive"` 并入统一 `GET /v1/work-history`（真超集，归档数据不丢）；`WorkHistoryView` 增加「任务归档」筛选 chip 与渲染。`ArchiveView.tsx` 删除（无引用）。
- **委托 → 审计**：`AuditReviewSurface` 增加「🤖 委托会话」tab，内嵌原 `ManagerView`（Manager↔Worker 分派会话/契约），保留人工审核队列 + 事件链。`ManagerView` 不再作为独立菜单，仅被审计视图引用。
- 侧栏 `NAV_ITEMS` 现为 7 项：对话 / 任务 / 记忆 / 权限 / 工作历史 / 仪表盘 / 审计。

验证：前后端 `tsc --noEmit` 全绿；`verify:workhistory` 19/0（断言已更新为五表超集）；运行态后端 `/v1/work-history` 实测 179 条（含 archive）。

**验证脚本（DB 行为级，2026-09-20 新增，全绿）**：
- `npm run verify:workhistory`（18 断言）：四表合并出全部 4 type、ILIKE 全文、session 过滤、user_id 隔离、limit/offset 分页。
- `npm run verify:auditapi`（20 断言）：app.ts 挂载 + 响应信封契约 {total,limit,offset,items} + 无 identity 返回空 + limit 上限 200。
- `npm run verify:managerprompt`（13 断言）：Phase 0b 留痕路径接线（源码）+ manager_messages 真实出现在审计流为 manager_prompt。
- 已并入 `verify:trust` 聚合。

**修复：verify 脚本当场抓出 3 个后端真实 bug（work-history.ts）**：
1. `manager_messages` 查询写死 `session_id` 列，但该表无此列（仅 `related_session_id`）→ 改为按 `related_session_id` 作用域 + SELECT 别名。
2. `whereJoined` 把表别名写死成 `t`，但 `task_worker_results` 查询用别名 `twr` → `t.user_id` / `t.payload_json` 无 FROM 入口 → 参数化 `tableAlias`。
3. `whereJoined` 全文检索回退列写死 `payload_json`，但 `task_worker_results` 没有该列（是 `result_json`）→ 参数化 `jsonCol`。

**排查结论（2026-09-21，已澄清，非 bug）**：
- 之前 verify 脚本跑 seed 时冒 `EVENT_WRITE_FAILED: primary store write failed`，原以为是 Phase 1c 哈希链静默失败。经一次性探针确认：**这是测试脚手架假象，不是生产缺陷**。根因：Event Backbone 的 `storePath` 只在完整应用启动 `src/index.ts` 的 `initEventStore(config.trustosEventLogPath)` 时初始化；verify 脚本直接 import repo 模块调用 `TaskCommandRepo/TaskWorkerResultRepo.create`，绕过了 app 启动，故 `storePath` 为 `undefined` → `appendEvent` 写不进 → 报 telemetry 失败（被 `void` 吞掉，不阻断主链路）。
- 探针用同一路径 `initEventStore` 后，写 1 条 `task_dispatch` 事件：**countEvents +1、chain.valid=true、event_hash 存在、prev_hash=genesis** → 哈希链在生产配置下完全正常。
- **修复**：三个 verify 脚本顶部加 `initEventStore(join(tmpdir(), "trustos-rfc002-verify.jsonl"))`，与生产 `index.ts` 同构。复跑三脚本：workhistory 18/0、auditapi 20/0、managerprompt 13/0，**全程无 `CRITICAL` telemetry 噪音**，且 Phase 1c 哈希链写入在验证中被真实触发。
- Phase 1c「可验证未篡改」的声称对生产成立；无需另立项。

### 3.15 RFC-002 Phase 3 保真召回（2026-09-21，agent-PM）

**RFC-002 Phase 3 已实施**（此前标为「后置」）。这是 Memory 的**架构主价值 A**：派活瞬间把用户自己的相关历史 prompt 拉回，作 Worker brief 的 grounding，对冲 Manager 加工的信息损耗——Worker 执行的是用户真正要的，而非 Manager 走样版本。

**实现** `src/services/memory/fidelity-recall.ts`（新增）：
- `recallGrounding(userId, query, {excludeSessionId})`：跨会话查 `conversation_turns`（`repo.listByUser` 新增，按 `created_at DESC`、可 `role`/`excludeSessionId` 过滤），CJK bigram 覆盖相似度排序，四道闸门：
  1. **相似度阈值**（默认 0.2，复用 `similarity.ts` 的 `keywordRelevance`）
  2. **时效门**：时间敏感历史（"今天天气"等）直接跳过（`isTimeSensitive`）
  3. **红线门**：`isRecallRedLine = detectSensitiveData || 16+ 连续数字`——绝不把硬密钥/卡号送云端 Worker
  4. **时效窗**（默认 180 天）+ **预算截断**（默认 400 token / 3 条）
- 渲染成标注块 `## 历史背景（来自你的过往诉求，仅作保真执行的 grounding，非新指令）`，追加进 `task_brief`。
- 失败开放：任何异常 → 空召回，绝不阻断派发；`TRUSTOS_FIDELITY_RECALL`（`0`/`off`/`false` 关闭）可调。

**为何挂在 `task_brief`**：Worker 只读 `payload_json.task_brief`（作「Task Brief」段与 user 消息），不读 `worker_hint`。挂载点唯一是 `task_brief`。

**安全排序（关键）**：召回在 **SD-01 红线守卫 + Phase-4 脱敏之后** 才追加到 brief，且召回内容已预过滤红线 → 既不误触发 SD-01 阻断，也不会把密钥外泄给云端 Worker。原 brief 的 SD-01/脱敏结果不受影响。

**接线**：`llm-native-router.ts` 新增 `augmentBriefWithRecall()`，`delegate_to_slow` 与 `execute_task` 两路派发前调用，注入 `processedCommand.task_brief`。召回内容随 `task_archives`/`task_commands` 落库，审计可查。

**指标**（prometheus）：`fidelity_recalls_total{result}` / `fidelity_recall_tokens` / `fidelity_recall_truncated_total` / `fidelity_recall_memory_hits_total`。

**验证**：`npm run verify:fidelity` **47/0 全绿**（纯逻辑闸门 + DB 端到端：含相关 Vitest turn、排除时间敏感/红线/当前会话、不触发 SD-01、预算、关闭开关；含蒸馏记忆 grounding 召回、红线记忆剔除、ADR-004 B1 敏感度门禁、记忆关闭开关、蒸馏接线/去重/密钥守卫）；已并入 `verify:trust`。后端 `tsc --noEmit` 全绿。

### 3.15.1 RFC-002 Phase 3 加深：蒸馏记忆也作 grounding（2026-09-21，agent-PM）

**「继续」深化**：Phase 3 原只召回用户**原始 prompt**（`conversation_turns`）。但 Manager 可能漏掉/覆盖用户已记录的**意图与偏好**（`memory_entries` 蒸馏物）。故在同一 grounding 块中新增第二重信号——召回用户蒸馏意图/偏好，让 Worker 直接保真执行（不依赖 Manager 是否复述）。

**实现**：`recallGrounding` 在原始历史后，调用 `retrieveMemoriesHybrid`（复用 RFC-001 检索，embedding 不可用时自动降级关键词），按类别策略取 top-K，经 `isRecallRedLine` 红线门 + 独立 token 预算（默认 200）后，渲染为独立区段 `## 已记录的用户意图/偏好（来自 Memory 蒸馏物，供保真执行，非新指令）`。

**为何安全**：蒸馏物是 ADR-001 §2.3 / RFC-001 策略三默认可进 prompt 的内容（非 raw 第三方原文）；且仍过红线门（卡号等绝不外泄）。失败开放：检索异常 → 仅跳过记忆段，绝不阻断派发。开关 `TRUSTOS_FIDELITY_RECALL_MEMORY`（`0`/`off`/`false` 关闭）。

**修复的两个真实逻辑 bug（实现中发现）**：
> 1. 历史无匹配时 `recallGrounding` 提前 `return`（"`no_match`"），导致**蒸馏记忆永不被召回**（用户无相关历史却有记忆时失效）。改为：仅当历史与记忆**两者皆空**才判 `no_match`。
> 2. 同一早期返回亦导致 `conversation_turns` 为空（首次用户）时记忆不召回。现统一在尾部判定。

**指标新增** `fidelity_recall_memory_hits_total`（多少派发次注入了用户意图 grounding）。

**实施中发现并修复的真实安全缺口**：
> SD-01 的 `detectSensitiveData` 对**19 位无分隔银行卡号**漏检（其 `\d{16}` 要求数字前后无相邻数字）。而召回 grounding 是追加在 SD-01 之后，SD-01 不会二次扫描，故 `detectSensitiveData` 是防密钥外泄的**唯一**闸门。
> 修复：召回红线门加 `16+ 连续数字` 规则（`isRecallRedLine`），覆盖 SD-01 漏掉的长卡号；宁可错杀（安全优先）。

### 3.15.2 边界收口：保真召回对记忆套用 ADR-004 B1 敏感度门禁（2026-09-21，agent-PM）

**「继续」第 1 项**：RFC-001 Phase 1 阶段2 安全边界收口——检索默认返回蒸馏物、原文（`unknown`/非 `public` 记忆）仅显式 `includeRaw` 才进云端模型。

**边界审计结论**：`MemoryEntry` 只有 `content`（蒸馏物）、**无 `raw_content` 字段**，故 `selectMemories`/`retrieveMemoriesHybrid` 天然只取蒸馏物，ADR-001 §2.3「检索默认返回蒸馏物」在存储模型层已满足。但发现**真实缺口**：刚落地的 Phase 3 保真召回把 `memory_entries.content` 注入云端 Worker brief 时，**只过了模式级红线门，没走 ADR-004 B1 的 remote 敏感度门禁**——而 `selectMemories`（Manager 路径）已强制 `remote` 仅放行 `public`。这意味着 `unknown`/`restricted` 记忆会被默认送进云端 Worker，违反 ADR-001 §2.3 与 ADR-004 B1。

**修复**：
- 导出 `injector.ts` 的 `REMOTE_ALLOWED_SENSITIVITIES`（`public`）作为单一事实源；
- `recallGrounding` 记忆回路新增 **门禁 5（敏感度）**：默认只放行 `public` 蒸馏记忆，`unknown/sensitive/restricted/internal` 一律拦截（observability：`stats.memoryBlockedBySensitivity`）；
- 新增 `includeRaw` 选项——显式 `true` 即视为用户确认，放行非 `public`（对应 ADR-001 §2.3「确需引用进 prompt 时须用户显式确认」）。

**验证（verify:fidelity 新增 2 条，现 41/0）**：
> - 非 `public` 记忆默认被拦截（`memoryBlockedBySensitivity > 0`、内容不进 block）；
> - `includeRaw: true` 时非 `public` 记忆被注入。

> 注：`conversation_turns`（用户自有 L1 原话）仍只过红线门——其送云端 Worker 与当前 prompt 同一信任模型（Worker 本就处理用户原话），红线门覆盖密钥/卡号等；记忆面则按 ADR-004 严格分级。

### 3.15.3 让 Memory 随使用真实积累：蒸馏接线 + 去重（2026-09-21，agent-PM）

**「继续」第 2 项**：L0 蒸馏器（`distilTurn`，零 LLM 调用、只认显式信号）其实**早已在 `api/chat.ts` 接线**（用户说"记住/以后都/我喜欢"即写 `memory_entries`）。所以"Memory 空"主要是设计使然（高精准、只认显式指令），而非完全没接线。审计发现的**真实缺口是去重**：同一指令重复说会创建重复记忆行，导致记忆膨胀/检索噪声。

**修复**：
- 抽出可单测的 `src/services/memory/distill-on-ingest.ts`（`distillTurnToMemory`）：蒸馏 → `partitionByConfidence` 取 active → **`MemoryEntryRepo.existsByContent` 去重** → `create`；失败开放、默认开（开关 `TRUSTOS_MEMORY_DISTILL`）。
- `MemoryEntryRepo` 新增 `existsByContent(userId, content)` 廉价去重探针。
- `chat.ts` 内联蒸馏块改为 `void distillTurnToMemory(userId, userText, sessionId).catch(...)`，非阻塞、逻辑集中、可测。

**验证（verify:fidelity 新增 6 条，现 47/0）**：显式信号落库（fact/auto_learn）；重复信号去重（仍为 1 行）；含密钥原话**绝不蒸馏**（distiller 的 `SENSITIVE_RE` 守卫）。蒸馏条目默认 `unknown` 敏感度，按 ADR-004 B1 仅进本地/Manager、不进云端 Worker，安全。

> 已知局限（**已解决 2026-09-22，计划 A**）：`distillTurnToMemory` 现同时持久化 `active` + `pending`，pending 进 `MemoryGovernanceSurface` 审阅队列，用户「✓ 确认」才激活并能被检索命中；审阅 UI 与接口早已齐备。

### 3.16 Memory 粘性闭环 A + RAG 本地模型 D（2026-09-22，agent-PM，按计划 PLAN-2026-09-21 执行）

按用户审批顺序 **A → B（验证） → D → C** 推进，B 项用户已采信既有核实（前端 tsc 0 / 无孤儿端点）标记 VERIFIED_DONE，不重复劳动。

**A — Pending 记忆审阅队列闭环**：
- 唯一真缺口：`distillTurnToMemory`（`src/services/memory/distill-on-ingest.ts`）原只持久化 `active`，低置信度 `pending` 被丢弃。改为 `partitionByConfidence` 同时取 `active`+`pending`，均经 `existsByContent` 去重后 `create`；pending 带 `PENDING_TAG`，`injector` 自然拦截（不进 prompt），待用户在 `MemoryGovernanceSurface` 确认/删除。
- 前端审阅 UI 与后端 list/confirm/delete/改敏感度接口**早已齐备**，无需改动。
- 验证：扩 `verify-memory-distiller.mts`（现 42/0）新增 §13 断言「低置信度→status:pending 且入 pending 分区」；`verify-memory-inject.mts` 37/0。

**D — RAG 本地模型用户可配**：
- 新增 `local`（OpenAI-compatible）provider：`EmbeddingConfig` 加 `baseUrl`；`getLocalEmbedding` 走 `${baseUrl}/embeddings`，`apiKey` 可选。
- 可运行时配置：**文件存储** `.trustos/embedding-settings.json`（`TRUSTOS_EMBEDDING_SETTINGS_PATH` 可覆盖；单用户本地 OS，零 schema 变更，与事件主干一致）。`resolveEffectiveEmbeddingConfig()` 单用户全局解析第一个 `enabled` 设置覆盖 env——保证记忆存储(memory-growth)与查询(memory-retrieval)用同一模型，向量维度天然一致。
- API：`GET/PUT /v1/settings/embedding`（身份中间件保护）+ `POST /v1/settings/embedding/validate` 探活（发 `input:"ping"`，返回向量维度并比对 `dimensions`）。`getEmbedding` 内部改调 resolver，retrieval 调用点无需改动。
- 前端：`EmbeddingSettingsPanel` 挂 `SettingsModal`，输入 provider/baseUrl/model/可选 key/维度，带「测试连接」「保存」；`api.ts` 新增 3 函数。
- 验证：后端 `tsc` 0；前端 `tsc` 0；`scripts/verify-embedding-settings.mts` **8/8 PASS**（无设置回退 env / local 覆盖 / disabled 回退 / store round-trip）。端到端待用户给本地地址实跑。
- 设计偏差（已决策）：原计划 DB 表 + migration，实现改文件存储——理由见上（单用户、零变更、additive）。

**C — TRST-5 Charter v0 收尾（文档，无代码）**：
- `TRST-5-charter-draft.md` 的 5F1/5F2 经 2026-09-21 验证为 VERIFIED_DONE（前端 tsc 0；全仓仅 1 处 `/v1/gateway` 引用且受 `GATEWAY_CONFIGURED` 守卫，不命中主后端、不 404），与 commit 3f1aa70 标注一致。charter 范围/优先级不变，可提交 v0 供 Boss 正式签核。
- 生产化 WP（5D 一键部署 / 5B 本机数据保护闭环 / 5E 本机健康 / 5A 轻量登录）仍待实施，不在 A/D 四项范围内。

详见 `docs/strategy/PLAN-2026-09-21-stickiness-trst5-rag.md`。

### 3.17 TRST-5 生产化 WP 收尾（2026-09-22，agent-PM）

按 Boss 签核的 TRST-5 Charter v0，推进生产化最小集。核查结论：**多数 WP 已实现，仅前端一处安全缺口需补**。

- **WP-5A 轻量身份**：`/auth/token` 发 JWT（`src/api/auth.ts`，恒定时间比较 + 24h 过期）；前端 `/login` 页 + `page.tsx` 门禁（`!token → /login`）。**已完成**。
- **WP-5B 本机数据保护闭环**：`src/middleware/identity.ts` 在 `jwtEnabled`（默认 true）下强制 JWT，X-User-Id 仅作交叉校验（不符即 403），无 JWT 即 401；`app.ts` 67–69 行在 `/api/*`、`/v1/*` 全局挂载。前端原 `api.ts` 401 恢复**硬编码 `changeme` 静默重登**——正好抵消真实登录（WP-5B 明确"只清 token 不算完成"）。已修复：401 改为清会话 + 派发 `trustos:auth-required`，`AuthContext` 监听清空、`/login` 门禁接管。**已完成**。
- **WP-5D 一键部署**：docs/geek-quickstart.md + standalone 固化（§3.12 已做）。**已完成**。
- **WP-5E 本机健康**：`metrics.ts`（完整 Prometheus registry）+ `readiness.ts` 已在 `app.ts` 79/80 行接线（`/metrics`、`/readiness`）。charter 注"已实现未接线"已过时。**已完成**。
- **WP-5F2 前端流畅度**：`page.tsx` 已用 `React.lazy` 做路由级代码分割（MemoryGovernance/Dashboard/Tasks/Permissions/Audit/WorkHistory 等按需 chunk）。**剩列表虚拟化 + 高频输入防抖 polish**（可选，非阻断）。

**验证**：前端 `npx tsc --noEmit` 绿（两次）；后端 tsc 绿（既有）。
**提交**：`a48297e`（RFC-001/002 + 清理 + 文档整批）、`a291801`（WP-5A/5B 前端修复）已 push origin。
**待决**：WP-5F2 虚拟化/防抖是否值得投入（个人高频路径已闭环，懒加载已覆盖首屏）；生产化整体可判 `PROD_READY`（个人安装可用）待 Boss 确认。

详见 `docs/strategy/TRST-5-charter-draft.md`。

## 4. 当前待办

| 状态 | 事项 |
|---|---|
| 🟢 已签核实施 | **RFC-002 Memory 审计/工作历史面**（ACCEPTED 2026-09-20；**Phase 0–3 完成**，前端 tsc 全绿；保真召回 2026-09-21 落地） |
| 🟢 已签核待实施 | RFC-001 Phase 1（5 项按建议全通过，2026-09-18；185 断言全绿已验证） |
| 🟢 已 push（2026-09-22） | 全部本地 commit 已推送 origin（github.com:443 本次连通；a48297e + a291801） |
| 🟢 已完成（2026-09-22） | **TRST-0 护栏同步** — 顶部变更提示 + §7 invariant 11/12 已为 ADR-001/002 新护栏（本地优先留存 + 外发强制加工），经核查无需改动 |
| 🟢 已完成（2026-09-22） | **Memory 粘性闭环 A** — 蒸馏器持久化 pending 进审阅队列，端到端闭合（前端审阅 UI 早已齐备） |
| 🟢 已完成（2026-09-22） | **RAG 本地模型 D** — 用户可配本地/OpenAI 兼容 embedding 端点（`/v1/settings/embedding` + 前端面板），记忆检索可本地化、数据不出本机 |
| 🟢 已签核（2026-09-22） | **TRST-5 Charter v0 收尾（C）** — Boss 正式签核；5F1 VERIFIED_DONE、5D docs 已做；**WP-5A/5B 已完成**（后端 `app.ts` 全局挂 `identityMiddleware` + JWT 强制；前端 `api.ts` 401 不再 `changeme` 静默重登、改清会话触发 `/login`）；**WP-5E 已完成**（`/metrics` + `/readiness` 已在 `app.ts` 接线）；**WP-5F2 部分**（路由级 `React.lazy` 已做，剩列表虚拟化/防抖 polish）；frontend tsc 绿 |

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
| `verify:fidelity` | 47 | RFC-002 Phase 3 保真召回（闸门纯逻辑 + DB 端到端，含蒸馏记忆 grounding + ADR-004 B1 敏感度门禁 + 蒸馏接线/去重） |
| **合计** | **168** | |
| *注* | *§5 仅列代表性分组；完整 20 组见 `package.json` 的 `verify:trust`* | |

## 6. 关键文档索引

| 文档 | 用途 |
|---|---|
| **`CURRENT-STATUS.md`**（本文件） | 会话恢复入口 |
| `TRST-execution-log.md` | 完整时间线（3828+ 行） |
| `ADR-001-local-first-egress-processing.md` | 护栏重述决策（本地存 + 外发加工） |
| `ADR-002-data-sovereignty-principle.md` | **数据主权原则**（为什么必须本地留存；分层主权模型 L1-L4） |
| `RFC-001-local-memory-distillation.md` | 主权数据战略 + Memory 蒸馏 + 四阶段演进路线（Phase 1 已签核实施并验证） |
| `RFC-002-memory-audit-work-history.md` | Memory 审计/工作历史面：原文→Manager prompt→派发任务→结果 可查可审计（ACCEPTED；Phase 0–2 完成，前端视图已接） |
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
