# TrustOS Private Beta — Reviewer Session Guide

```text
Version: v1.1 (Doc Fix Batch DF1-DF6)
Date: 2026-08-04
Duration: 45–55 minutes
Mode: Self-guided walkthrough with optional observer
```

---

## Quick Start

Choose your reviewer path based on your role:

### Path A — Technical Reviewer / Operator

You will run setup, gateway, smoke, and trace demo independently.

1. Clone, install, configure `.env` with API key
2. Start gateway: `npx tsx --env-file=.env scripts/trst1/start-gateway.ts`
3. Send one non-streaming request
4. Run smoke: `npm run trst3:smoke`
5. Run trace demo: `npm run trst3:trace-demo`
6. Review evidence bundle
7. Read limitations
8. Fill feedback form

### Path B — Business / Governance Reviewer

You join a guided walkthrough. An observer or operator handles terminal commands. You review:

1. Dashboard (if available) — inspect traces, risk assessment, control recommendations
2. Evidence interpretation — see `docs/private-beta-evidence-interpretation-guide.md`
3. Limitations — read `docs/private-beta-limitations.md`
4. Feedback — fill `docs/private-beta-feedback-form.md`

You do **not** need to run npm/curl personally. Your value is in evaluating whether the governance concepts (dry-run, hash evidence, trace correlation) are clear and useful.

### Path C — Security / Privacy Reviewer

You focus on the evidence and privacy properties:

1. Inspect events — confirm no raw prompt/output in event store
2. Inspect evidence bundle — confirm `raw_content_included=false`
3. Verify dry-run — confirm no request is blocked or modified
4. Review identity model — confirm agent_id is label-based
5. Review archive limitations — confirm no durable persistence, no signing
6. Read limitations — cross-check against observed behavior

You may run terminal commands if comfortable, or work with an observer/operator.

---

## 1. Session Purpose

你将亲身体验 TrustOS 的 Private Beta 版本，目标是验证：

- 作为一个 reviewer，你能否**独立完成** TrustOS 的观测→评估→证据导出流程（技术路径），或通过引导理解其治理价值（业务/治理路径）
- 你是否能**正确理解** TrustOS 当前做什么、不做什么
- 你对产品**有什么反馈** — 困惑、需要、改进建议

**这不是测试你的能力，而是测试产品是否足够清晰。**

---

## 2. What TrustOS Currently Does

TrustOS 是一个 AI governance 观测层：

| 能力 | 说明 |
|---|---|
| 观测 AI gateway 调用 | 记录每次 LLM 请求的哈希、trace、元数据 |
| 评估风险 | 检测隐私/运营/证据完整性信号 |
| Dry-run 控制建议 | 推荐 allow/review，不实际拦截请求 |
| 证据导出 | 隐私安全的证据包（仅含哈希和元数据） |
| 哈希复核 | Reviewer 侧 SHA256 验证输出一致性 |

---

## 3. What TrustOS Does Not Do

| 不提供的 | 原因 |
|---|---|
| 请求拦截 / 强制执行 | Dry-run 模式 |
| 经过认证的身份 | agent_id 是 label-based |
| 多租户 / RBAC | 不在 Private Beta 范围 |
| 加密签名 / 公证 | 信任模型基于哈希 |
| 法律级合规记录 | 证据包不支持 |
| 生产级 gateway SLO | 功能验证版本 |
| 流式请求 | 本次 walkthrough 仅验证非流式路径 |

完整限制见：`docs/private-beta-limitations.md`

---

## 4. Setup Instructions

### 环境要求

- Node.js 20+
- npm
- 一个 LLM API key（OpenAI 兼容接口）
- Git

### 步骤

```bash
# 1. 克隆项目
git clone <repo-url>
cd trustos

# 2. 切换分支
git checkout feature/trst-3-private-beta-readiness

# 3. 安装依赖
npm install

# 4. 创建 .env 文件
# 内容如下 (替换为你的实际值):
# TRUSTOS_UPSTREAM_BASE_URL=<your-llm-api-base>
# TRUSTOS_UPSTREAM_API_KEY=<your-api-key>
```

---

## 5. Walkthrough Flow

### Step 1 — 启动 Gateway (3 min)

```bash
npx tsx --env-file=.env scripts/trst1/start-gateway.ts
```

你应该看到:

```text
TrustOS Gateway — Private Beta
  Listening: http://localhost:8787
  Mode: Shadow (dry-run control only)
  ...
```

验证健康检查：

```bash
curl http://localhost:8787/health
```

期望：HTTP 200，包含健康状态字段。

> **卡住了？** 检查 `.env` 文件是否存在且 API key 有效。如果端口冲突，可以在 `.env` 中设置 `TRUSTOS_GATEWAY_PORT`。

### Step 2 — 发送测试请求 (3 min)

```bash
curl -s -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-TrustOS-Agent-Id: reviewer-test" \
  -d '{"model":"<any-model>","messages":[{"role":"user","content":"Hello, TrustOS Private Beta test."}],"stream":false}'
```

期望：

- HTTP 200
- 响应头包含 `X-TrustOS-Trace-Id`
- 响应体是正常的 LLM 回复

记录 trace_id（实际格式以返回为准）。

### Step 3 — 查看事件 (5 min)

```bash
tail -5 .trustos/events.jsonl
```

或使用 jq 格式化：

```bash
tail -1 .trustos/events.jsonl | node -e "process.stdin.on('data',d=>console.log(JSON.stringify(JSON.parse(d),null,2)))"
```

检查以下字段是否存在：

- `event_id`
- `trace_id`
- `event_hash`
- `input_hash`
- `output_hash`
- `event_type`
- `status`

注意：事件记录不应包含原始 prompt 或原始 output 完整文本。

### Step 4 — 运行自动化验证 (5 min)

```bash
npm run trst3:smoke
```

观察输出，记录 PASS/FAIL/SKIP 结果。

#### What Smoke Results Mean (Non-Technical Summary)

如果 smoke test 通过（PASS），表示：

| # | 含义 | 通俗解释 |
|:---|:---|:---|
| 1 | Gateway 正常运行 | 系统在运行 ✅ |
| 2 | 成功发出 AI 调用 | 能观测到一次真实的 AI 请求 ✅ |
| 3 | 事件包含 trace_id 和所有哈希 | 创建了可验证的数字指纹 ✅ |
| 4 | Fresh 非流式事件的 output_hash 覆盖为 100% | 新生成的事件有完整哈希 ✅ |
| 5 | 证据导出保持隐私安全 | 证据不含原始对话内容 ✅ |
| 6 | 控制保持 dry-run 模式 | 系统观察但不拦截任何请求 ✅ |

> **关于 output_hash 覆盖率**：100% output_hash 覆盖仅适用于本 walkthrough 中生成的 **fresh successful non-streaming 事件**。TRST-2C 之前创建的历史事件可能缺少 output_hash — TrustOS 现在诚实地将其检测为证据完整性信号，而不是静默忽略。

### Step 5 — 多事件 Trace 演示 (5 min)

```bash
npm run trst3:trace-demo
```

观察：同一个 trace_id 下面有多少个事件？每个事件是否有完整的哈希？

### Step 6 — 查看 Evidence Bundle (5 min)

如果你有 Dashboard 可用：

1. 打开 Dashboard
2. 找到一个事件链
3. 点击 Export Evidence
4. 检查证据包内容：
   - 是否包含原始 prompt/output？（应该不包含）
   - `raw_content_included` 是否为 false？
   - 能否看到 event_hash / input_hash / output_hash？

### Step 7 — 阅读 Limitations (5 min)

打开 `docs/private-beta-limitations.md`，确认你理解了：

- TrustOS 做什么 / 不做什么
- Dry-run 的含义
- 证据的限制
- 身份模型的限制

### Step 8 — 填写反馈表 (10 min)

打开 `docs/private-beta-feedback-form.md`，诚实填写。

---

## 6. Tasks to Perform

| # | Task | 状态 |
|---:|---|---|
| 1 | git clone + npm install | [ ] |
| 2 | 创建 .env 并配置 API key | [ ] |
| 3 | 启动 Gateway | [ ] |
| 4 | Health check | [ ] |
| 5 | 发送 model_call 并查看响应 | [ ] |
| 6 | 查看 events.jsonl 确认哈希字段 | [ ] |
| 7 | 运行 trst3:smoke | [ ] |
| 8 | 运行 trst3:trace-demo | [ ] |
| 9 | 查看 evidence bundle | [ ] |
| 10 | 阅读 limitations 文档 | [ ] |
| 11 | 填写反馈表 | [ ] |

---

## 7. What to Observe

在执行过程中，请留意：

- **是否有任何一步让你困惑？** 哪一步？为什么？
- **你是否理解了 dry-run 的含义？** 自己用一个场景验证。
- **证据包是否让你感到安全？** 你觉得缺了什么吗？
- **哈希复核概念是否清晰？** 你知道怎么用自己的方式验证吗？
- **有没有哪句话让你觉得 TrustOS 在做它其实做不到的事情？**

---

## 8. How to Give Feedback

使用 `docs/private-beta-feedback-form.md`。

反馈原则：

- 诚实：说你觉得的，不是你觉得我们想听的
- 具体：哪个步骤、哪个词、哪句话让你困惑
- 建设性：如果某个东西不清楚，你期望它是什么样？

---

## 9. Troubleshooting Notes

| 问题 | 可能原因 | 尝试 |
|---|---|---|
| Gateway 无法启动 | .env 缺失或 API key 无效 | 检查 .env，确认 key 格式 |
| curl 返回 connection refused | Gateway 未启动或端口不对 | 确认 Gateway 日志中的端口号 |
| 响应不是 HTTP 200 | 模型名无效或 API 限制 | 确认模型名是否被上游 API 支持 |
| events.jsonl 为空 | 事件写入失败 | 检查 Gateway 日志；确认 `.trustos/` 目录有写权限 |
| Smoke 失败 | Gateway 不在运行 | 确认 Gateway 仍在运行且健康 |
| `output_hash` 缺失 | 可能是历史事件 | 用 `tail -1` 看最新事件，fresh 非流式事件应有 `output_hash` |

如果以上步骤无法解决，且你被卡住超过 5 分钟，请向 observer 求助或记录在反馈中。

---

## 10. Time Estimate

| Phase | 预计时间 |
|---|---|
| Setup | 5–8 min |
| Gateway 启动 + 测试请求 | 5 min |
| 事件查看 + 验证 | 10 min |
| Smoke + Trace demo | 8 min |
| Evidence + Limitations | 8 min |
| 反馈填写 | 10 min |
| **总计** | **45–50 min** |

剩余 10 分钟用于意外排错和开放讨论。

---

## 10. Operator Notes (Private Beta)

> **这是 Private Beta 运行说明，不是生产部署指南。**

| 事项 | 说明 |
|:---|:---|
| 事件存储 | 事件写入本地 `.trustos/events.jsonl` 文件 |
| 证据持久化 | 证据包由前端复制到剪贴板，TrustOS 后端不做持久化 |
| 运行环境 | 应在受控的本地/测试环境中运行 Gateway |
| 日志/事件重置 | sessions 之间可以清空重置 |
| 生产部署 | **这不是生产部署模型**，不提供 SLO/SLA |
| 日志轮转 | 当前版本无自动日志轮转，events.jsonl 会持续增长 |

---

## References

- `docs/private-beta-reviewer-handoff.md` — Reviewer 入口说明
- `docs/private-beta-limitations.md` — 完整限制列表
- `docs/private-beta-walkthrough.md` — 技术 walkthrough
- `docs/private-beta-feedback-form.md` — 反馈表
- `docs/private-beta-evidence-interpretation-guide.md` — 证据解读指南（面向业务/治理 reviewer）

---

> **Status**: Reviewer Session Guide — v1.1 (2026-08-04, DF1/DF2/DF3/DF5/DF6 applied)  
> **Note**: 保持 claims honest — dry-run only, privacy-safe evidence, hash-based verification, label-based identity.
