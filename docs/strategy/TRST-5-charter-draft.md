# TRST-5 — Private Beta → 生产化闭环最小集 Charter (v0 DRAFT)

```text
Version: v0 (agent-PM draft, 2026-08-24)
Owner: Boss (scope sign-off) + Agent (PM gate authority delegated 2026-08-24)
Branch: feature/trst-3-private-beta-readiness
Status: DRAFT_FOR_BOSS_SCOPE_SIGN-OFF
Baseline spec: TRST-5-product-spec.md (v1, 产品目标+全景图+待实现)
Discussion: TRST-5-discussion-2026-08-24.md
Target user: 极客优先(愿跑容器); 真技术深度; Memory=粘性钩子; 先修破碎
```

---

## 0. 为什么需要 TRST-5（背景与定位）

MWT-0..MWT-7 全部 SEALED (v0)。完整产品闭环已验证：
Observe → Visualize → Correlate → Assess (4D backend) → Control (4F dry-run) →
Prove (4A evidence) → Evidence Export (4B)。

但 **MWT-7 FULL 生产化** 在 roadmap 中长期 DEFERRED —— 即以下能力从未真正落地，
TrustOS 至今是 Private Beta Candidate（READY_WITH_ENV_BLOCKERS），不是生产可用：
- **Auth**：前端/后端无真实身份校验（X-User-Id 模拟头）；
- **RBAC**：无角色/权限边界（Manager/Worker/Reviewer 权限混用）；
- **Deploy**：standalone 输出受 `NEXT_PRIVATE_STANDALONE` 控制，无部署/编排流程；
- **Monitoring**：无运行期可观测（事件计数、策略命中、错误率均仅本地 jsonl）。

**2026-08-24 Boss 决策（关键定位 — 产品本质）**：TrustOS 是**个人 PC 的操作系统
（本地 OS），不是云操作系统**。大模型与系统是"安装在本机上的应用软件"。因此：
- **类比 PC OS 的三件事**：像 Windows/macOS 一样，只做 **支持（兼容/驱动应用软件）+
  性能优化（跑得顺、快）+ 安全（本机数据保护）**，不做云平台的租户/集群/治理。
- **多租户（Multi-tenant）明确剔除** —— 本机单用户，无多用户共享实例，无需 tenant 隔离。
- **身份确认从简** —— 像 PC 锁屏一样，本地轻量登录即可，不需要企业级 SSO/MFA/目录。
- **精力重心** —— 不投入云平台工程，而是投向**本机支持/性能/安全 + 个人工作流体验
  （完整/方便/高效/高性能）**。这才是 TRST-5 的真实价值目标。

这就是非正式的 "TRST-5" 概念的真实指代 —— **不是 MWT 的延续，而是一份新 charter，
把 Private Beta 收口为"个人 PC 操作系统级"可用的最小闭环**。

核心原则（继承自 TRST-0.3 冻结共识 + PM 2026-07-30 决策备忘 + 2026-08-24 Boss 决策）：
1. 先验证完整产品闭环，再决定是否生产化 —— 闭环已验证，现在到了收口时刻。
2. **像 PC OS 而非云 OS** —— TRST-5 只做本机支持/性能/安全 + 个人体验，
   不引入云平台工程（无 k8s、无多区域、无计费、无 SSO 联邦、无多租户、无集群治理）。
3. **本机体验优先** —— 资源优先服务于"应用软件跑得顺、本机数据安、个人工作流高效"，
   而非企业级治理复杂度。
4. 每次决策前判断：是否在服务本机应用软件与个人工作流？是否过早云平台化？

---

## 1. 范围（Scope）

### 1.1 MUST-HAVE（个人 PC 操作系统级最小闭环）

类比 PC OS 三支柱：**支持（兼容/驱动应用软件）· 性能优化 · 安全（本机数据保护）**。
TRST-5 不做云平台治理，只把本机这三件事做扎实。优先级由 2026-08-24 功能评估决定：
**部署 > 安全闭环 > 前端性能与构建修复**（见 §7 评估表）。

| 优先级 | ID | PC-OS 支柱 | 能力 | 最小交付（基于已有功能，不重做） | 不在范围内 |
|--------|----|-----------|------|----------|-----------|
| P0 | 5D | 支持 | 个人 PC 一键安装 | standalone 构建 + **本地 SQLite 模式**（去 Postgres+Redis+MinIO+pgvector 5 容器依赖）+ 大白话安装向导；固化 `NEXT_PRIVATE_STANDALONE` | 容器编排、多实例、蓝绿、全栈 docker |
| P0 | 5B | 安全 | 本机数据保护闭环（基于已有 manager+worker 隔离做身份强制） | **非重复已有隔离**，补服务端身份缺口：强制 JWT、关闭 `X-User-Id` 盲信、permissions/workspaces 用认证身份(非自报 user_id)、tasks GET 补归属校验 | 企业 RBAC、ABAC、细粒度策略引擎 |
| P0 | 5F1 | 性能 | 前端构建修复 | 修 `TSC_FAIL`；移除/接好 5 个孤儿 `/v1/gateway/*` 端点(api.ts:666 等后端未挂载→404) | — |
| P1 | 5F2 | 性能/体验 | 应用软件跑得顺 | 路由级代码分割(Suspense/lazy)、列表虚拟化、防抖；个人高频路径闭环且步数少、本地 `events.jsonl` 读写高性能 | 企业协作、多人看板 |
| P1 | 5E | 支持/性能 | 本机健康可见 | 挂载 `/metrics` + 暴露 `readiness` HTTP（已实现未接线）；类任务管理器读数 | 外部 APM、告警平台 |
| P2 | 5A | 安全 | 轻量本机登录 | 本地登录会话（类 PC 锁屏），`X-User-Id` 在 dev 外失效；配合 5B | 企业 SSO/OIDC、MFA |

> 5C Multi-tenant：已按 2026-08-24 Boss 决策**剔除**（本机单用户，无多租户需求）。
> 隐喻：TrustOS = 个人 PC 操作系统；大模型与系统 = 安装的应用软件。目标 = 做好支持/性能/安全。
> 已强功能（保留不重做）：Manager/Worker 架构隔离、事件主干、Assessment、Evidence/签名、
> Memory 治理、前端审计/治理面板、后端 Redis 缓存/索引/压缩、/health。
> 企业卖点（不进 TRST-5）：Evidence Merkle 锚定、opt-in DLP、哈希链 —— 与个人 PC 用户关系弱。

### 1.2 SHOULD-HAVE（按需，不阻塞生产化）

- 5G：reviewer 会话证据归集（MWT-12 operator 证据）自动化入仓（替换手动模板）。
- 5H：secrets 管理约定（env 注入 + 启动校验，非 vault）。

### 1.3 EXPLICITLY OUT OF SCOPE（防生产化蔓延）

- 多租户 / Multi-tenant（Boss 2026-08-24 明确剔除）。
- 流式（4B streaming）—— 已 DEFERRED。
- 后端证据持久化服务（4C）—— 已 DEFERRED，5E 仅做计数不落库新表。
- 策略引擎重写（4F 已是 config-flagged dry-run/live）。
- 企业 RBAC / ABAC / SSO 联邦 / k8s / 多区域 / 计费。

---

## 2. 设计约束（继承自冻结共识）

- **Evidence Graph / Event Backbone**：事件仍走 `.trustos/events.jsonl` + hash-chain，5E 监控只读计数，不改写事件模型。
- **No silent event loss**：监控采集失败不得吞事件。
- **Tamper-evident（非 tamper-proof）**：5A 会话令牌可轮换，不引入 HSM。
- **No raw content expansion**：5A/5B 不新增 raw_prompt/raw_output 落库。
- **Enforcement → Observation → Governance**：5B 仅做个人数据保护边界，不新增阻断逻辑。
- **个人体验优先**：5F 优化必须 measurable（启动时间、操作步骤数、P95 响应），不堆功能。

---

## 3. 工作包（Work Packages）与 DoD

执行顺序（依赖链）：**5A → 5B → 5D → 5E**（部署/监控可与身份并行）；**5F 个人体验贯穿全程，优先投入**；5G/5H 可选。

### WP-5A: 轻量真实身份（MUST）
- 本地登录端点（前端 + 后端），签发会话令牌；现有 `X-User-Id` 模拟头在 dev 之外失效。
- 8 AC：登录/登出/令牌校验/过期/错误密码/无令牌 401/审计事件含 actor_id/tsc 绿。

### WP-5B: 本机数据保护 — 基于已有 manager+worker 隔离做身份强制（MUST，depends 5A）
**前提（已存在，不重做）**：manager+worker 架构隔离（`local-manager-runtime.ts` +
`manager-view.ts` + `context-package.ts`）已代码级强制 artifact 原文不发 Manager、
raw history/memory 不发两端、Worker 仅收 brief；DB 层与 agent-sessions/session-events/
tasks PATCH 路由已有 userId 归属校验。5B 不重复这些，只补**服务端身份合法性**缺口。

- 核心修复（`src/middleware/identity.ts`）：`jwtEnabled` 下缺失/无效 JWT 一律 401；
  不再以 `X-User-Id` 作为身份来源（仅作反向校验，须与 JWT sub 一致）；关闭无 JWT 时的
  header 盲信（dev fallback 仅 `ALLOW_DEV_FALLBACK=true` 生效）。
- 接入最薄弱路由：`/v1/permissions/*`、`/v1/workspaces/*` 纳入同一身份中间件（approve/deny
  须校验归属，杜绝冒名批准/跨用户写工作区）。
- 顺带闭合剩余缺口：tasks GET result/summary/traces/decision 补 ownership 校验；
  event store 加 `user_id` scoping（events.jsonl/SQLite 现有仅 session_id）。

- AC（9 项）：未登录/无 JWT 401 / 伪造 X-User-Id 且与 JWT sub 不符 403 / 冒名 approve
  拒绝 / tasks GET 跨用户 404 / event 查询按 user 隔离 / permissions·workspaces 接入身份层
  / 现有 manager+worker 隔离不回归（context curation 测试仍绿）/ 41 确定性 PASS 不回归 / tsc 绿。
- 注意：仅做前端登出清 token **不算完成**——服务端 `X-User-Id` 仍可被伪造，必须在
  `identity.ts` 强制 JWT。

### WP-5D: 一键部署（MUST，depends 无）
- 固化 `NEXT_PRIVATE_STANDALONE` 为部署默认；单节点 runbook + health check 脚本。
- 8 AC：standalone 构建成功/runbook 可复现/health endpoint/回滚步骤/tsc 绿。

### WP-5E: 轻量监控（MUST，depends 5A）
- 最小可观测：事件计数 + 4F 命中 + 错误率 → stdout/health；不新增持久化表。
- 9 AC：计数准确/不吞事件/health 可读/无新增 raw/tsc 绿。

### WP-5F: 个人工作流体验（UX/效率/性能）（MUST，并行优先）
- 针对个人高频路径做完整闭环 + 效率/性能优化，目标 measurable：
  - 启动时间（前端冷启动 / backend 启动）P95 下降；
  - 高频操作步数减少（如一次会话内完成 observe→assess→export）；
  - 本地数据读写（events.jsonl）高性能、无卡顿；
  - 反馈即时（评估/控制结果低延迟呈现）。
- 9 AC：核心工作流端到端可用/启动时间达标/高频路径步数下降/本地读写无卡顿/tsc 绿。

### WP-5G: Reviewer Evidence Ingest（SHOULD）
- 自动化归集 MWT-12 reviewer 会话证据，替换手动 markdown 模板。
- 8 AC。

### WP-5H: Secrets Bootstrap（SHOULD）
- 启动校验必需 env（DATABASE_URL/OPENAI_*/GATEWAY_*），缺失即失败并给出明确原因。
- 8 AC。

**全局 DoD（12 项）**：
1. 无新增 raw 内容落库。
2. 无 schema 破坏性变更（migration 全 additive + DROP 可逆）。
3. 无新依赖（除非 Boss 明确批准）。
4. 现有 41 确定性 PASS / 0 FAIL 不回归。
5. 5E 监控不引入事件模型变更。
6. 5A 令牌可轮换、可撤销。
7. 每个 WP 独立 commit，单分支。
8. `npm run validate` 退出 0（无真实 FAIL）。
9. 部署 runbook 可在干净机器复现。
10. 回滚步骤文档化（5A 令牌失效 / 5D 重启）。
11. 无 secrets 提交（.env gitignored）。
12. 不触发 4F/4B/4C DEFERRED 项；不做多租户。

---

## 4. 风险登记

| 风险 | 影响 | 缓解 |
|------|------|------|
| R-5A-1 会话令牌实现引入 crypto 边界泄漏到 frontend bundle | 前端构建失败（类 MWT-7B 复现） | 复用 MWT-7B import-boundary guard；5A 后端独占 crypto |
| R-5D-1 standalone 部署与 dev 行为不一致 | 中 | 5D runbook 明确 env 差异；health check 验证 |
| R-5F-1 体验优化变功能堆砌（偏离个人效率目标） | 中 | 5F 优化必须 measurable（启动/P95/步数），无量化目标不做 |
| R-PREMATURE 范围蔓延到平台工程（含误加多租户） | 高 | 1.3 OUT OF SCOPE 硬约束；任一 WP 超界即 HOLD |

---

## 5. 验证与门禁

- 每个 WP 独立冒烟 + 回归（沿用 `scripts/trst/run-validation.mts` 分节）。
- 全局：`npm run validate` 退出 0；`npm run beta:check` 无回归。
- 生产化就绪判定（新增 verdict）：`PROD_READY` = 无 FAIL + 无 ENV_BLOCKED + 5A/5B/5D/5E/5F PASS。
  当前 Private Beta Candidate → 以上完成后可晋升 `PROD_READY`（个人安装可用）。

---

## 6. 功能评估表（2026-08-24，重规划依据）

原则：TrustOS = 个人 PC 操作系统（本地 OS）；大模型/系统 = 本机应用软件；TRST-5 = 支持+性能+安全。

| # | 功能域 | 代码现状 | 支持 | 性能 | 安全 | 与原则冲突/不足 |
|---|--------|----------|------|------|------|----------------|
| 1 | Manager/Worker 隔离 | 代码级强制（artifact 不发 M、raw 不发两端、Worker 仅收 brief） | — | — | ✅强 | 不冲突（5B 基石，不重做） |
| 2 | 事件主干 | events.jsonl+SQLite 索引+event_hash；EventChainViewer | ✅ | ✅ | ✅ | 哈希链 DEFERRED（非痛点） |
| 3 | Assessment | 后端 /v1/assess 4 级+dry-run | ✅ | — | ✅ | 不冲突 |
| 4 | Evidence/签名/锚定 | MWT-4/4E/4F/4R SHA256+Ed25519+Merkle+opt-in DLP | — | — | ✅强 | 企业卖点，个人用户弱，不进 TRST-5 |
| 5 | Memory 治理 | MWT-6 确定性记录+前端面板 | — | — | ✅ | 不冲突 |
| 6 | 前端审计/治理面板 | AuditReview/MemoryGovernance/Chain 已接线 | ✅ | — | ✅ | 不冲突 |
| 7 | 后端缓存/索引/压缩 | Redis 缓存+DB 索引+上下文压缩 | — | ✅后端强 | — | 不冲突 |
| 8 | /health | 完整并挂载，前端已接 | ✅ | — | — | 不冲突 |
| 9 | 部署/安装 | 仅全栈 docker-compose（PG+Redis+MinIO+pgvector 5 容器） | ❌缺失 | — | — | **冲突：个人装不上** |
| 10 | 鉴权实情 | JWT 安全但非强制；X-User-Id 盲信；permissions 用自报 user_id | — | — | ⚠️弱点 | **冲突：本机数据保护未闭环** |
| 11 | 前端性能 | 仅 4 useMemo；0 Suspense/lazy/debounce/虚拟化 | — | ❌薄 | — | **不足：应用跑不"顺"** |
| 12 | 前端构建 | tsc-status=TSC_FAIL；5 孤儿 /v1/gateway 端点未挂载→404 | ⚠️破碎 | — | — | **冲突：宣称有实为 404** |
| 13 | 监控 metrics | metrics/readiness 已实现未挂载 HTTP；仅 /health 通 | ⚠️半 | — | — | **不足：本机健康未闭环** |

**结论**：强项保留不重做；与原则三大冲突 = 部署缺失(P0) / 安全未闭环(P0) / 前端性能+构建破碎(P0)；企业卖点(Evidence/DLP/锚定)不进 TRST-5。

---

## 7. 重规划后的执行顺序

P0（阻塞"个人 PC 可用"）：**5D 安装 → 5B 安全闭环 → 5F1 构建修复**
P1（让应用"跑得顺"）：**5F2 前端流畅度 → 5E 本机健康**
P2（配合）：**5A 轻量登录**

---

## 8. 下一步（需 Boss 拍板）

- [ ] **Boss scope sign-off**：确认 §1.1 + §6 评估 + §7 优先级（P0=5D/5B/5F1）即"个人 PC OS 最小闭环"。
- [ ] 批准首 WP：`APPROVE_TRST-5_IMPLEMENTATION`（建议从 **5D 个人 PC 一键安装** 起，它解锁"装得上"）。
- [ ] 确认 5D 是否采用**本地 SQLite 模式**（去 Postgres+Redis 依赖，真正单文件/单进程安装）。
- [ ] 确认是否引入新依赖（如 standalone 打包、SQLite 驱动）；默认不引入。
- [ ] 确认 5F 个人体验的优先子项（启动速度 / 工作流步数 / 本地读写性能 的权重）。

> 注：此 charter 为 agent-PM 起草稿。Charter scope 仍由 Boss 作为 owner 签核。
> 常规 gate/acceptance 与基线修复 agent 已获授权自主执行。
