# TrustOS 文档地图

> **用途**：文档检索入口。本仓库 `docs/` 下约 160 篇文档，无索引时无法追溯。
> **设计原则**：按**当前有效性**分层，而非平铺文件名。
> **维护**：新增文档请归入对应层级；阶段结束后将当期文档移入 §4 归档。

*最后更新：2026-08-29*

---

## 1. 入口：只读这 3 篇（新会话必读）

| 文档 | 作用 |
|---|---|
| **`CURRENT-STATUS.md`** | **会话恢复卡片** — 当前分支、最近 commit、待办、验证入口、环境坑。**最先读这个** |
| `TRST-execution-log.md` | 完整时间线（3930 行，按时间追加，追溯历史用） |
| `CLAUDE.md` | 项目规则（含「Documentation Discipline」文档纪律） |

---

## 2. 当前有效的核心文档

### 2.1 战略与定位

| 文档 | 说明 |
|---|---|
| `TrustOS-OS-Manifesto.md` | OS 定位宣言 |
| `TRST-0-trustos-architecture-thesis.md` | 战略架构基线 ⚠️ **护栏表述已被 ADR-001 变更，待同步** |
| `TRST-threat-model-v0.1.md` | 威胁模型基线 |
| `trustos-manager-worker-trust-architecture.md` | Manager/Worker 信任架构（40KB，最详尽的架构文档） |
| `trustos-roadmap-rebaseline-2026-08.md` | 路线图 |
| `TRST-5-charter-draft.md` / `TRST-5-product-spec.md` | 当前阶段（TRST-5）章程与规格 |
| `TRST-5-discussion-2026-08-24.md` | Boss 产品决策记录（单用户、Memory 是粘性钩子等） |

### 2.2 决策记录（ADR / RFC）

| 文档 | 状态 | 说明 |
|---|---|---|
| `ADR-001-local-first-egress-processing.md` | **ACCEPTED** | 护栏重述：本地优先存储 + 外发强制加工 |
| `RFC-001-local-memory-distillation.md` | **待拍板** | 本地存储 + Memory 增量蒸馏设计（5 个决策点） |

### 2.3 系统评估

| 文档 | 说明 |
|---|---|
| `trst-system-review-and-competitive-analysis-2026-08-28.md` | 系统全景 + 与主流 Agent 框架对比 + **诚实实现度评估**（真实 vs 占位） |

### 2.4 规格与契约（仍生效）

| 文档 | 说明 |
|---|---|
| `../GATED-DELEGATION-v2.md` | G0-G4 委托管线规格 |
| `../LLM-NATIVE-ROUTING-SPEC.md` | LLM 原生路由规格 |
| `../MANAGER-DECISION-SCHEMA.md` / `MANAGER-DECISION-TYPES.md` | Manager 决策契约 |
| `../SSE-EVENT-PROTOCOL-v1.md` | SSE 事件协议 |
| `../ARCHITECTURE-OVERVIEW.md` | 架构总览 |
| `../runtime-flow.md` | 运行时流程 |
| `../dev-rules.md` | 开发规则 |
| `frontend-api-contract.md` | 前后端 API 契约 |

### 2.5 Private Beta（仍在进行）

`../private-beta-*.md`（12 篇）：验收、审阅者指南、限制声明、走查等。
入口：`../private-beta-walkthrough.md`、`../private-beta-limitations.md`

---

## 3. 按主题的深入文档

| 主题 | 文档 |
|---|---|
| 证据与导出 | `MWT-4A-task-evidence-projection-brief.md`、`MWT-4-task-evidence-prebrief.md`、`MWT-5-architecture-prebrief.md`、`trst-4a-evidence-report-ux-closure.md` |
| 策略执行 | `TRST-4F-policy-enforcement-charter.md`、`TRST-threat-model-v0.1.md` |
| 身份与鉴权 | `TRST-4E-authenticated-identity-charter.md` |
| 流式 / Gateway | `trst-4b-streaming-gateway-support-charter.md`、`trst-4b-streaming-validation-closure.md` |
| 任务与追踪 | `MWT-3-session-task-trace-unification-brief.md`、`MWT-3B-object-model-design-review.md`、`MWT-3B1-minimal-task-correlation-brief.md` |
| 前端 | `TRST-frontend-readiness.md`、`../frontend-module-audit-2026-08-06.md` |
| 验证体系 | `TRST-validation-baseline.md`、`TRST-validation-governance.md`、`TRST-regression-expansion-guide.md` |
| 风险与阻塞 | `TRST-risk-register.md`、`TRST-blocked-work-register.md`、`TRST-standing-engineering-backlog-report.md` |

---

## 4. 历史归档（阶段已完成，仅作追溯）

| 阶段 | 文档组 |
|---|---|
| TRST-1 | `TRST-1-execution-trace-charter.md`、`TRST-1-mvp-test-plan.md` |
| TRST-2 | `TRST-2-charter.md`、`TRST-2-closure-report.md`、`TRST-2-hardening-report.md` |
| TRST-4 规划 | `TRST-4-charter-draft.md`、`trst-4-rebaseline-and-next-milestone.md`、`trst-4x-console-rebaseline-complete.md`、`TRST-4F-go-live-decision-pack.md`、`TRST-4G-production-ops-baseline-charter.md` |
| MWT-0~3 | `mwt-0-code-archaeology-report.md`、`mwt-1-implementation-brief.md`、`MWT-2-worker-run-lifecycle-brief.md`、`MWT-3A-closure-report.md` |
| MWT-4B 导出 | `MWT-4B-*.md`（约 30 篇，含多个空文件） |
| MWT-5 决策过程 | `MWT-5-*.md`（8 篇，决策过程稿，结论已纳入 §2.1） |
| MWT-20 | `MWT20-private-beta-product-walkthrough.md` |
| CHECKPOINT_2 审阅 | `CHECKPOINT_2-*.md`（8 篇，含 1 个空文件） |
| Sprint 报告 | `../SPRINT-*.md`、`../Sprint-46-Report.md`、`../S93P-final-validation-report.md`、`../s94p-validation-report.md` |
| 其他历史 | `../ROADMAP-2026Q2.md`、`../L2-ROLLout-PLAN.md`、`../PHASE-2/3/4-*.md`、`../CODE-REVIEW-2026-05-11.md` |

---

## 5. ⚠️ 空文档（占位未填写，12 篇）

创建后从未填写。保留以便追溯"曾计划但未完成"，如确认无用可删。

```
CHECKPOINT_2-review-decision-matrix.md
MWT-4B-export-data-classification.md
MWT-4B-export-field-allowlist.md
MWT-4B-export-qa-checklist.md
MWT-4B-export-rollback-plan.md
MWT-4B-export-test-plan.md
MWT-4B-export-user-warning-copy.md
MWT-4B-implementation-plan-draft.md
MWT-4B-privacy-red-team-cases.md
TRST-next-decision-options.md
TRST-open-questions-register.md
TRST-doc-map.md          ← 本文件（已于 2026-08-29 填写）
```

---

## 6. 文档约定

| 项 | 约定 |
|---|---|
| 命名 | 小写连字符 + 日期后缀（如 `xxx-2026-08-29.md`） |
| 决策记录 | `ADR-00X-<主题>.md`（已决策） |
| 方案提案 | `RFC-00X-<主题>.md`（待拍板，先写后做） |
| 位置 | 战略/阶段文档放 `docs/strategy/`；技术规格放 `docs/` |
| 完成时 | 更新 `CURRENT-STATUS.md` + 补录 `TRST-execution-log.md` |
| 归档 | 阶段结束后在 §4 登记 |

---

## 7. 追溯建议

**「我想知道……」→ 该读哪里**

| 问题 | 文档 |
|---|---|
| 现在项目什么状态？下一步做什么？ | `CURRENT-STATUS.md` |
| 某个改动为什么这么设计？ | `TRST-execution-log.md` + 对应 `ADR-`/`RFC-` |
| 系统有哪些能力、哪些是空壳？ | `trst-system-review-and-competitive-analysis-2026-08-28.md` §4 |
| 安全护栏是什么？ | `ADR-001` + `TRST-threat-model-v0.1.md` |
| 历史某次决策的依据？ | `TRST-execution-log.md`（按时间） |
| 环境坑 / 踩过的雷？ | `CURRENT-STATUS.md` §7 |
