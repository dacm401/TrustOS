# TrustOS 产品说明书（v1 — 产品目标与新基线）

```text
版本: v1 (agent-PM 起草, 2026-08-24; 依据 TRST-5-discussion-2026-08-24)
定位: 个人 PC 操作系统（本地 OS）；大模型与系统 = 安装在本机上的应用软件
目标用户: 先服务愿自己跑容器的极客（小白后说）
产品原则: 真技术深度 + 本地优先 + 数据不出本机
粘性钩子: Memory（随使用积累、迁移成本高的个人 AI 记忆）
性质: 本说明书为后续开发的唯一基线，区分【已有(真实/半/占位) / 待实现】。任何新开发不得偏离。
```

---

## 1. 一句话定位

> **TrustOS 是一个跑在你自己电脑上的"AI 工作台操作系统"：你用自然语言下达任务，本机 Manager
> 拆解并调度 Worker 调用大模型/工具完成，全程记录可审计的执行轨迹、风险评估与证据链——所有数据留本地。**

类比：像 Windows 装了个"AI 任务调度 + 操作审计"的系统软件，大模型是它管理的应用。

---

## 2. 产品目标（新基线，不可偏离）

| 目标 | 含义 | 非目标（防反复） |
|------|------|------------------|
| **极客优先** | 先让愿跑容器的极客好用、有真实体验 | 不做小白一键安装（暂） |
| **真技术深度** | 信任/审计/隔离架构做实、做可见，不削弱 | 不堆企业治理/多租户 |
| **本地优先** | 数据不出本机、可验证 | 不做云端协同/多人 |
| **修破碎优先** | 先消除 TSC_FAIL / 404 / 静默坏，再上新 | 不在破碎上叠功能 |
| **Memory 粘性** | Memory 做成真实、随用生长的个人记忆 | 不把 Memory 当成演示 |

---

## 3. 已有功能全景图（截至 2026-08-24）

> 状态图例：✅真实可用 ｜ ⚠️半/占位 ｜ ❌缺失/破碎 ｜ 🔌孤儿(已实现但用户不可达)

### 3.1 核心工作流（极客可用面）
| 功能 | 状态 | 说明 |
|------|------|------|
| 自然语言对话下达任务（SSE 流式） | ✅ | `ChatInterface` → `POST /api/chat` |
| Manager 智能路由（LLM-Native Router） | ✅ | `src/services/llm-native-router.ts` |
| Worker 执行任务（含 real 模式 + 产物归档） | ✅ | `execution-attempt-service.ts` |
| 任务全生命周期（列表/轨迹/证据/resume/pause/cancel） | ✅ | `TasksView.tsx` |
| 权限审批 approve/deny | ✅ | `PermissionsView.tsx` |
| Manager 会话与委托合约 | ✅ | `ManagerView.tsx` |
| 归档产物检索 | ✅ | `ArchiveView.tsx` |
| 工作台统计/成本/成长 | ✅ | `DashboardView.tsx` |
| 本地登录会话 `/auth/token` | ✅(后端) | 前端 `/login` 可用；JWT 非强制（见 §4） |

### 3.2 信任与可观测（有深度，但多数为孤儿/占位）
| 功能 | 状态 | 说明 |
|------|------|------|
| 执行轨迹/事件链（events.jsonl + SQLite 索引 + event_hash） | ✅引擎 / 🔌前端孤儿 | `EventChainViewer` 未被引用 |
| 风险评估 `/v1/assess`（4 级 none/low/medium/high + dry-run） | ✅ | 前端接线同样在孤儿 EventChainViewer |
| 证据报告 + SHA256 指纹 + Ed25519 签名 + 合规锚定 | ✅引擎(MWT-4/4E/4F/4R) / 🔌`OverviewView`+`EvidenceReportPanel` 孤儿 | 无用户可读报告页 |
| Memory 治理（MWT-6，真实引擎） | ✅引擎 / ⚠️UI 占位 | `MemoryGovernanceSurface` 7 张写死 fixture，零 fetch |
| Audit 审计面板 | ⚠️占位 | `AuditReviewSurface` 4 张写死 fixture |
| 本机健康 /health | ✅ | 已挂载，前端已接 |
| /metrics、readiness | ⚠️半 | 已实现未挂载 HTTP；仅 /health 通 |

### 3.3 安全与隔离
| 功能 | 状态 | 说明 |
|------|------|------|
| Manager/Worker 数据隔离（代码级强制） | ✅强 | artifact 不发 M、raw 不发两端、Worker 仅收 brief |
| 本机数据防越权 | ❌缺口 | `X-User-Id` 盲信(`identity.ts:54-59`)；permissions/workspaces 用自报 user_id |

### 3.4 部署
| 功能 | 状态 |
|------|------|
| 极客友好部署（一键 compose + 文档 + 可选单机） | ❌仅 5 容器 docker-compose，无清晰文档 |
| 前端工程健康 | ❌`TSC_FAIL`；5 孤儿 `/v1/gateway/*` 调用→404；0 懒加载/虚拟化/防抖 |
| 孤儿组件（用户不可达） | 🔌ManagerWorkspace(43KB)/OverviewView/AdminPanel(39KB)/CommandPalette 等约 51 组件中多数不可达 |

---

## 4. 待实现内容（TRST-5 路线图，按 P0→P2）

> 全部为"接线 / 暴露 / 修复"，非从零造功能。基于已有引擎。

### P0 — 让极客第一眼跑通（阻断体验）
- **P0-A 修首屏 404**：`api.ts:653/694/757/768/1386` 的 `/v1/gateway/*` 用错 base+前缀；
  真实 gateway 在 `:8787/events` 等（无 `/v1/gateway`）。改用 `GATEWAY_URL` 去前缀（参照 `fetchGatewayHealth` at `api.ts:203`）。
- **P0-B 解锁前端 tsc**：`tsc-status.txt=TSC_FAIL`；首嫌疑 `frontend/src/types/memory-governance.ts:22,27`
  跨 rootDir 引用后端 `../../../src/services/mwt6/*`。跑 `tsc --noEmit` 取真实报错并修。
- **P0-C 极客友好部署**：清晰 `docker-compose` 文档 + `.env.example` + 启动脚本（可选单机模式讨论）。

### P1 — 让深度可见 + Memory 粘性
- **P1-A Memory 真实化（粘性钩子）**：新增 `/v1/memory/governance`（复用 `memory-governance.ts:30/40`）
  并挂载 `app.ts`；`MemoryGovernanceSurface.tsx` 把 `allFixtures` 换 fetch（渲染层已对齐真实语义，几乎不改）。
- **P1-B 暴露深度界面**：接线 `EventChainViewer`(事件链+评估)、`OverviewView`+`EvidenceReportPanel`(证据)、
  `ManagerWorkspace`、`AdminPanel`、`CommandPalette`；或清理删除暂不接者。
- **P1-C 本机健康可见**：挂载 `/metrics` + 暴露 `readiness` HTTP。

### P2 — 安全闭环（配合极客信任）
- **P2-A 本机数据保护**：强制 JWT、关闭 `X-User-Id` 盲信、permissions/workspaces 用认证身份（非自报）、
  tasks GET 补归属校验、event store 加 `user_id` scoping。

### 明确不做（防反复护栏）
- ❌ 多租户 / Multi-tenant
- ❌ 企业 RBAC / ABAC / SSO 联邦 / MFA
- ❌ k8s / 多实例 / 蓝绿 / 计费
- ❌ 流式(4B) / 后端证据持久化服务(4C) / 策略引擎重写(4F) / 哈希链（非极客痛点）

---

## 5. 竞争力与粘性（讨论结论）

**差异点（对极客成立）**：本地优先 + 数据不出本机 + 可验证；真·审计引擎（签名/锚定）；Manager/Worker 隔离架构。
**粘性钩子**：Memory 随用生长、迁移成本高 —— 优先级高于锦上添花的企业治理。
**共识**：竞争力不缺弹药，缺"极客第一眼跑通 + 看见深度"。顺序：P0 修破碎 → P1-A Memory → P1-B 深度界面。

---

## 6. 防反复护栏（开发守则需遵守）

1. 新功能先对齐"是否服务极客真实工作流 + 是否有真技术深度"，否则 HOLD。
2. 不复用已有能力时先查代码（manager+worker 隔离、MWT-6 引擎、Assessment 等已存在）。
3. 前端 TSC 必须保持绿；孤儿端点/组件接入前先确认后端路由真实存在。
4. Memory 真实化优先级高于企业治理特性。
5. 本说明书 + `TRST-5-charter-draft.md` + `TRST-5-discussion-2026-08-24.md` 为唯一基线，改前先更新文档。
