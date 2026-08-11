# TrustOS Private Beta — Round 1 Plan

```text
Version: v1.1 (Doc Fix Batch DF1-DF6)
Date: 2026-08-04
Baseline: TRST-3 MVP CLOSED
Maturity: Private Beta Ready — Reviewer Handoff Prepared
Mode: Long-horizon execution — documentation and program ops only
```

---

## 1. Round Objective

验证 TrustOS (TRST-3 MVP) 具备向受控 Private Beta reviewer 开放的最低产品基准。

具体验证：

- Reviewer 能否独立完成 setup 和 walkthrough
- Reviewer 是否能正确理解 dry-run 语义
- Reviewer 是否理解证据包的隐私安全属性
- Reviewer 是否能信任 hash-based verification
- 产品语言是否 overclaim

输出：一个四种判定之一的 Round 1 closure recommendation。

### Reviewer Paths

Reviewers 可按自身背景选择以下路径之一（详见 `docs/private-beta-reviewer-session-guide.md` Quick Start）：

| Path | Audience | 角色 |
|---|---|---|
| **Path A** — Technical / Operator | Engineering, operator reviewers | 独立运行 gateway, smoke, trace demo |
| **Path B** — Business / Governance | Governance, risk, product reviewers | 引导式 walkthrough；observer/operator 操作终端 |
| **Path C** — Security / Privacy | Security, privacy-focused reviewers | 聚焦证据内容、隐私属性、dry-run 验证 |

三条路径均通过同一反馈表 (`private-beta-feedback-form.md`) 采集结构化反馈。

---

## 2. Reviewer Profile & Selection Criteria

推荐 **3–5 位 reviewer**，覆盖以下 profile：

| # | Profile | 关注重点 | 关键验证点 |
|---:|---|---|---|
| 1 | AI Product / Engineering | 技术可用性和产品闭环 | 能否独立 setup，理解 event/trace 模型 |
| 2 | Governance / Risk | 风险和治理信号 | 是否理解 risk assessment 信号，信任 dry-run 建议 |
| 3 | Security / Privacy | 隐私安全属性 | 是否信任 evidence bundle 不含 raw content，理解哈希复核 |
| 4 | Developer / Operator | 操作实用性和集成 | setup friction，API contract，操作文档清晰度 |
| 5 | Skeptical Non-Builder | 非技术视角的可信度 | 是否理解 TrustOS 做什么/不做什么，是否发现 overclaim |

Selection criteria：

- 未参与 TRST-3 MVP implementation
- 未深度阅读 TrustOS 内部设计文档
- 愿意投入约 45–60 分钟独立 reviewer session

---

## 3. Number of Reviewers

```text
Minimum: 3
Target: 4
Maximum: 5
```

如果某个 profile 无法覆盖，允许 3 人执行并标注缺失 profile。

---

## 4. Session Format

每个 reviewer 独立进行 session，推荐格式：

| Aspect | Default |
|---|---|
| Session type | 远程 video call 或 async 独立 walkthrough |
| Duration | 45–60 分钟 |
| Observer | ≥1 内部 observer，只记录不发问（除非 reviewer 明确求助） |
| Recording | 不允许录音录像（保护 reviewer 坦诚反馈） |
| Materials | `docs/private-beta-reviewer-session-guide.md` + handoff doc |
| Environment | Reviewer 自有环境 (Node.js)，自备 API key |

Observer 使用 `docs/private-beta-observer-checklist.md` 记录。

---

## 5. Pre-Session Requirements

Reviewer 应在 session 前完成：

- [ ] 收到 `private-beta-reviewer-handoff.md`
- [ ] 收到 session guide
- [ ] 确认时间和技术环境（Node.js, npm, API key）
- [ ] 了解 TrustOS 是 dry-run observation system，不做 enforcement

Session 当天 observer 确认：

- [ ] 环境就绪
- [ ] Gateway 可启动
- [ ] Smoke 可运行
- [ ] API key 有效

---

## 6. Review Tasks

Reviewer 需执行：

| Task | 材料 | 预计时间 |
|---|---|---|
| Setup & Gateway 启动 | session guide | 5 min |
| Health check & test request | session guide | 5 min |
| Event 查看和 hash 验证 | session guide | 10 min |
| Multi-event trace demo | session guide | 5 min |
| Evidence bundle 查看 | session guide | 5 min |
| Limitations 阅读确认 | `private-beta-limitations.md` | 5 min |
| 填写反馈表 | `private-beta-feedback-form.md` | 10 min |
| 开放讨论 | — | 5–10 min |

总计：45–55 分钟。

---

## 7. Observer Responsibilities

每个 session 的 observer 必须：

- [ ] 对照 `docs/private-beta-observer-checklist.md` 逐项记录
- [ ] 不主动引导 reviewer（除非 reviewer 明确求助且卡住 > 2 min）
- [ ] 不解释 TrustOS 内部实现（除非 reviewer 明确询问）
- [ ] 记录 reviewer 原话（困惑、疑问、建议）
- [ ] 标注 overclaim 嫌疑：reviewer 是否误解了 TrustOS 能力范围

Observer **不应**：

- 帮 reviewer 写命令
- 纠正 reviewer 的干系理解（除非 overclaim 风险）
- 在 reviewer 完成前提供正确理解的答案

---

## 8. Feedback Collection Method

Primary：`docs/private-beta-feedback-form.md` 结构化评分 + 开放问题

每个 reviewer 需提交：

1. 结构化评分 (1–5)
2. 选择题回答
3. 开放文字反馈
4. Optional: 截图/screen recording

Observer 同步提交：

1. `docs/private-beta-observer-checklist.md` 记录
2. Session note (1–2 段文字摘要)

---

## 9. Acceptance Thresholds

详见 `docs/private-beta-acceptance-rubric.md`。

摘要：

### PASS_PRIVATE_BETA_REVIEW_ROUND_1

```text
- ≥80% reviewers complete core walkthrough
- ≥80% understand dry-run correctly
- ≥80% understand evidence contains hashes, not raw content
- No critical overclaim confusion
- No privacy regression
- No fresh event hash failure
- Average trust score ≥ 4/5
- Average comprehension score ≥ 4/5
```

### PASS_WITH_DOC_FIXES

```text
- Product works technically
- Main confusion is documentation, setup wording, or explanation
- No product loop break
- No privacy/security regression
```

### NEEDS_PRODUCT_FIX_CHARTER

```text
- Multiple reviewers fail due to product behavior, not docs
- Reviewer cannot understand or trust evidence even after explanation
- Core loop requires code/product change
```

### BLOCKED

```text
- Gateway cannot start for reviewers
- Fresh events fail hash validation
- Evidence contains raw content
- Dry-run is misleading or appears as enforcement
- Serious privacy/security issue
```

---

## 10. Decision Outcomes

| Outcome | PM Action |
|---|---|
| PASS | Approve proceeding to next phase; consider TRST-4 chartering |
| PASS_WITH_DOC_FIXES | Apply doc changes; re-validate with 1–2 follow-up reviewers |
| NEEDS_PRODUCT_FIX_CHARTER | Draft product-fix charter; TRST-4 scoping |
| BLOCKED | Immediate PM escalation; root-cause investigation |

---

## 11. Escalation Rules

Observer 发现以下情况必须**立即**停止 session 并上报 PM：

1. Gateway 无法启动
2. 响应中包含原始 prompt 或 raw content
3. 证据包暴露敏感信息
4. Reviewer 明确表示 dry-run 文案构成误导
5. 任何可能的隐私或安全 incident

---

## 12. Timeline

```text
Day 0 (now):
  - Round 1 program docs created
  - Preflight validation run/confirmed
  - CHECKPOINT_1 reported

Day 1–3:
  - Reviewer recruitment
  - Conduct 3–5 reviewer sessions
  - Observer notes collected

Day 3–4:
  - Feedback synthesis
  - Classification: doc fix vs product fix
  - CHECKPOINT_2 reported

Day 4–5:
  - Closure report drafted
  - PM decision recommendation
  - CHECKPOINT_3 reported
```

如果无真实 reviewer，创建 reviewer-ready package 并标注 `SIMULATED_REVIEW`。

---

## 13. Private Beta Operator Notes

> **这些是 Private Beta 运行说明，不是生产部署指南。**

| 事项 | 说明 |
|:---|:---|
| Gateway 运行模式 | `npx tsx --env-file=.env` — 本地开发模式 |
| 事件存储 | 本地 `.trustos/events.jsonl` 文件写入，无数据库持久化 |
| 证据导出 | 前端复制到剪贴板；TrustOS 后端不做持久化 |
| 运行环境 | 应在受控本地/测试环境中运行 Gateway |
| 会话间隔 | 事件可在 sessions 之间重置 |
| 生产级保障 | **不提供** SLO/SLA、高可用、日志轮转 |

---

## References

- `docs/private-beta-reviewer-handoff.md` — Reviewer 入口文档
- `docs/private-beta-limitations.md` — 已知限制
- `docs/private-beta-walkthrough.md` — 技术 walkthrough
- `docs/private-beta-reviewer-session-guide.md` — Session 操作指南
- `docs/private-beta-observer-checklist.md` — Observer 记录清单
- `docs/private-beta-feedback-form.md` — 结构化反馈表
- `docs/private-beta-acceptance-rubric.md` — 判定标准
- `docs/private-beta-preflight-validation.md` — 前置验证
- `docs/private-beta-round-1-closure-template.md` — Closure 报告模板
- `docs/private-beta-evidence-interpretation-guide.md` — 证据解读指南

---

> **Status**: Round 1 Plan — v1.1 (2026-08-04, DF1/DF5 applied)  
> **Next**: Real reviewer recruitment
