# TrustOS Private Beta Reviewer Handoff

> **To**: Private Beta Reviewer  
> **From**: TrustOS PM  
> **Date**: 2026-08-05 (updated for TRST-4B streaming support)  
> **Project**: TrustOS  
> **Phase**: Private Beta Reviewer Handoff  
> **Branch**: `feature/trst-3-private-beta-readiness`  
> **Mode**: Dry-run control only — TrustOS observes, assesses, and recommends, but does not enforce.

---

## Quick Start

Choose your path:

### Path A — Technical Reviewer / Operator
1. Set environment variables (API key)
2. Start gateway: `npx tsx --env-file=.env scripts/trst1/start-gateway.ts`
3. Send one non-streaming request
4. Run smoke: `npm run trst3:smoke`
5. Run trace demo: `npm run trst3:trace-demo`
6. Review evidence
7. Read limitations
8. Fill feedback form

### Path B — Business / Governance Reviewer
1. Join guided walkthrough (observer/operator runs terminal commands)
2. Inspect trace correlation, risk signals, dry-run control
3. Review evidence interpretation — see `docs/private-beta-evidence-interpretation-guide.md`
4. Read limitations — `docs/private-beta-limitations.md`
5. Fill feedback form — `docs/private-beta-feedback-form.md`

You do **not** need terminal or coding experience. Your focus: are governance concepts clear and useful?

### Path C — Security / Privacy Reviewer
1. Inspect event store — confirm no raw prompt/output
2. Inspect evidence bundle — confirm `raw_content_included=false`
3. Verify dry-run — confirm no requests blocked or modified
4. Cross-check limitations against observed behavior

---

## 1. Private Beta Reviewer Handoff Note

你即将体验的是 TrustOS 的 Private Beta 版本。

TrustOS 是一个 AI trust/governance 产品，目标是让 reviewer 能够：

- 观测 AI gateway 调用
- 评估风险
- 了解控制建议
- 导出隐私安全的证据包
- 使用哈希复核输出一致性

当前版本的核心约束（请务必了解）：

- 控制建议是 dry-run 模式 — TrustOS 不实际拦截、修改或修复任何请求
- 身份标识是 label-based — 不是经过认证的身份
- 证据包是隐私安全的 — 不包含原始提示词或原始模型输出
- 证据导出是前端复制到剪贴板 — 不做后端持久化
- 证据包不是法律级的合规记录 — 不包含签名或公证
- Private Beta walkthrough 支持流式（`stream=true`）和非流式（`stream=false`）请求（TRST-4B 已验证）。流式 SSE 响应在完成时可验证；失败或中断的流式输出不含 `output_hash`（诚实语义）
- 不支持多租户、RBAC、生产级 gateway SLO

你需要准备：

- Node.js 20+
- npm
- 一个 LLM API key（OpenAI / SiliconFlow 等兼容接口）
- 约 30 分钟

请按以下顺序进行 walkthrough：

1. 阅读已知限制
2. 阅读验证摘要
3. 执行 walkthrough checklist
4. 填写 reviewer 反馈问题

---

## 2. Reviewer Walkthrough Checklist

### Phase 1: 环境准备 (5 min)

- [ ] 克隆项目并切换到 `feature/trst-3-private-beta-readiness` 分支
- [ ] 确认 `npm install` 完成
- [ ] 设置环境变量:

  ```bash
  TRUSTOS_UPSTREAM_BASE_URL=<your-llm-api-base>
  TRUSTOS_UPSTREAM_API_KEY=<your-api-key>
  ```

### Phase 2: 启动 Gateway (2 min)

- [ ] 运行: `npx tsx --env-file=.env scripts/trst1/start-gateway.ts`
- [ ] 确认输出显示 "TrustOS Gateway — Private Beta"
- [ ] 确认显示 "Mode: Shadow (dry-run control only)"
- [ ] 确认显示 "Evidence: Privacy-safe, hash-based verification only"
- [ ] 运行健康检查: `curl http://localhost:8787/health`
- [ ] 确认 HTTP 200，并返回健康状态字段（例如 `status=ok`，具体字段以当前实现为准）

### Phase 3: 发送测试请求 (3 min)

- [ ] 发送一个非流式 model_call:

  ```bash
  curl -s -X POST http://localhost:8787/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "X-TrustOS-Agent-Id: private-beta-reviewer" \
    -d '{"model":"<any-model>","messages":[{"role":"user","content":"Hello, this is a Private Beta test."}],"stream":false}'
  ```

- [ ] 确认返回 HTTP 200
- [ ] 确认响应中有 `X-TrustOS-Trace-Id` header
- [ ] 记录返回的 trace_id（实际格式以当前 gateway 返回为准，格式不应作为验证重点）

### Phase 4: 验证事件记录 (3 min)

- [ ] 查看事件日志最后几行:

  ```bash
  tail -3 .trustos/events.jsonl
  ```

- [ ] 确认刚生成的事件包含以下字段:
  - [ ] `event_id` — 事件唯一 ID
  - [ ] `trace_id` — 与 Phase 3 中的 X-TrustOS-Trace-Id 一致
  - [ ] `event_hash` — SHA256 事件哈希
  - [ ] `input_hash` — 输入哈希
  - [ ] `output_hash` — 输出哈希 (64 位十六进制字符串)
  - [ ] `event_type` — 应为 `model_call`
  - [ ] `status` — 应为 `success` 或 `200`
- [ ] 确认 TrustOS 事件不包含原始 prompt/output 的完整文本（用于 review 的证据路径依赖哈希和元数据）

### Phase 5: 运行自动化验证 (5 min)

- [ ] 运行 Private Beta Smoke:

  ```bash
  npm run trst3:smoke
  ```

  或: `node scripts/trst3/run-private-beta-smoke.mjs`

- [ ] 确认大部分检查项为 PASS
- [ ] 如果有 WARN 项，阅读说明了解是否为已知限制
- [ ] 确认 fresh successful non-streaming events 的 `output_hash` coverage 为 100%
  - > **注意**：100% output_hash 覆盖仅适用于本 walkthrough 生成的 fresh successful non-streaming 事件。TRST-2C 之前创建的历史事件可能缺少 output_hash（TrustOS 现在诚实地检测为证据完整性信号，而非静默忽略）。

### Phase 6: 多事件 Trace 演示 (3 min)

- [ ] 运行 Multi-Event Trace Demo:

  ```bash
  npm run trst3:trace-demo
  ```

  或: `node scripts/trst3/run-multi-event-trace-demo.mjs`

- [ ] 确认输出显示 10/10 PASS
- [ ] 确认同一 trace_id 下有多个事件
- [ ] 每个事件都有 event_hash / input_hash / output_hash

### Phase 7: Dashboard 审查 (5 min)

- [ ] 如果 Dashboard 可用，打开并查看事件链
- [ ] 找到 Reviewer 解释面板（可折叠）
  - [ ] 阅读风险评估说明
  - [ ] 阅读控制建议说明
  - [ ] 阅读证据导出说明
- [ ] 悬停在 RiskBadge 上查看风险级别解释
- [ ] 悬停在 ControlBadge 上查看 dry-run 说明
- [ ] 选择一个事件链，点击 Export Evidence
  - [ ] 确认证据包不含原始内容
  - [ ] 确认看到 privacy-safe / copy-only 说明
  - [ ] 检查 `raw_content_included` 为 false

### Phase 8: 确认理解 (2 min)

- [ ] 我能解释为什么事件被评为低/中/高风险
- [ ] 我理解 "dry-run" 意味着没有请求被实际拦截
- [ ] 我理解证据包包含哈希但不含原始内容
- [ ] 我理解 TrustOS 当前不支持哪些能力

---

## 3. Demo Script

### Demo Script (5 分钟版)

#### 0. 前置说明 (30s)

"TrustOS 是一个在 AI gateway 层提供观测、评估和证据导出的系统。当前版本是 dry-run 模式 — 它观察和评估风险，但不实际拦截请求。所有证据都是隐私安全的 — 基于哈希而不是原始内容。"

#### 1. 启动 Gateway (30s)

展示:

- 运行 `npx tsx --env-file=.env scripts/trst1/start-gateway.ts`
- 确认输出: "TrustOS Gateway — Private Beta"
- 确认: "Mode: Shadow (dry-run control only)"
- 展示健康检查通过

#### 2. 发送请求 + 事件观测 (60s)

展示:

- 发送一个 chat completion 请求
- 确认 `X-TrustOS-Trace-Id` header
- 展示 `.trustos/events.jsonl` 中新生成的事件
- 指出关键字段: trace_id, event_hash, input_hash, output_hash
- 强调: "本 walkthrough 生成的 TrustOS event 不应包含原始 prompt 或原始 output；用于 review 的证据路径依赖哈希和元数据。"

#### 3. Smoke 验证 (60s)

展示:

- 运行 `npm run trst3:smoke`
- 展示 PASS 结果
- 指出: fresh successful non-streaming events 的 `output_hash` coverage 100%, evidence privacy-safe

#### 4. Multi-Event Trace (60s)

展示:

- 运行 `npm run trst3:trace-demo`
- 展示同一 trace_id 下有 3 个事件
- "三个事件属于同一次 agent 推理链路"
- "Reviewer 可以通过 trace_id 查看完整的推理过程"
- 每个事件有完整哈希

#### 5. Dashboard + Evidence (60s)

展示:

- Reviewer 解释面板: 风险/控制/证据三段说明
- RiskBadge tooltip: low / medium / high 解释
- ControlBadge: dry-run 说明
- Export Evidence: 复制到剪贴板
- 证据内容: 无原始 prompt/output

#### 6. 收尾 (30s)

"这就是 TrustOS Private Beta 的完整产品闭环:  
Observe → Assess → Dry-run Control → Evidence Export → Reviewer Verification

当前不支持: 拦截执行、认证身份、多租户、法律级公证。  
这些能力在未来的版本中考虑。"

---

## 4. Known Limitations

### TrustOS 当前支持

| 能力 | 状态 |
|---|---|
| AI gateway 事件观测 | ✅ |
| 事件哈希与 trace 标记 | ✅ |
| 基于治理信号的风险评估 | ✅ |
| Dry-run 控制建议 | ✅ |
| 隐私安全证据包生成 | ✅ |
| Reviewer 侧哈希复核 | ✅ |

### TrustOS 当前不支持

| 能力 | 说明 |
|---|---|
| 请求拦截或强制执行 | Control 保持 dry-run，不实际阻断 |
| 经过认证的 agent 身份 | 身份标识是 label-based |
| RBAC 或企业级权限控制 | 不在 Private Beta 范围 |
| 租户隔离 | 不在 Private Beta 范围 |
| 持久化合规存档 | 当前 beta 使用本地 JSONL 事件文件；证据包不由 TrustOS 后端持久化 |
| 加密签名或公证 | 当前信任模型基于哈希复核 |
| 法律级证明 | 证据包不是合规记录 |
| 生产级 gateway SLO | 当前为功能验证版本 |

### 技术限制

- Private Beta walkthrough 支持流式（`stream=true`）和非流式（`stream=false`）请求（TRST-4B 已验证）。流式 SSE 响应在完成时可验证；失败或中断的流式输出不含 `output_hash`（诚实语义）
- 证据导出为前端复制模式，无下载功能
- 无后端证据持久化
- 事件存储为本地 JSONL 文件
- 无 `/assess` REST endpoint（评估在 Dashboard 客户端进行）

---

## 5. Validation Evidence Summary

### TRST-3 MVP Implementation Results

- **Branch**: `feature/trst-3-private-beta-readiness`
- **Base**: 667a978 (TRST-2C)
- **Files**: 7 changed (4 new, 3 modified), +418/-14
- **Dependencies**: 0 added, 0 removed

### Automated Validation

| Test | Result |
|---|---|
| Private Beta Smoke (8 phases) | 20 PASS / 0 FAIL / 0 WARN / 1 SKIP |
| Multi-Event Trace Demo | 10 PASS / 0 FAIL |
| output_hash coverage (fresh successful non-streaming events) | 100% |
| Evidence privacy-safe | ✅ raw_content_included=false |
| Control dry-run mode | ✅ confirmed |
| Auth / RBAC / DB / policy / crypto | 0 introduced |

### WP-by-WP Acceptance

| WP | Content | AC | Status |
|---|---|---|---|
| WP1 | Canonical Gateway Startup Path | 10/10 | ✅ |
| WP6 | Private Beta Limitations Statement | 8/8 | ✅ |
| WP2 | Reviewer Explanation Improvements | 8/8 | ✅ |
| WP3 | Evidence Export Clarity | 9/9 | ✅ |
| WP4 | Runtime E2E Smoke | 9/9 | ✅ |
| WP5 | Multi-Event Trace Demo | 8/8 | ✅ |

### TRST-3 MVP DoD

12/12 DoD PASS ✅

### Known Non-Blocking Issues

1. `run-prove-evidence-smoke.mjs` port mismatch (pre-existing, not TRST-3 regression)
2. No `/assess` REST endpoint (dashboard client-side evaluation)
3. Historical pre-TRST-2C events may lack `output_hash` — TrustOS detects these as evidence-integrity signals. Fresh successful non-streaming events have 100% output_hash coverage.

### Additional Reviewer Resources

- **Evidence Interpretation Guide**: [`docs/private-beta-evidence-interpretation-guide.md`](./private-beta-evidence-interpretation-guide.md) — 面向业务/治理 reviewer 的证据解读指南，解释每个字段的含义及其治理价值。

---

## 6. Reviewer Feedback Questions

请在完成 walkthrough 后回答以下问题。你的反馈将直接影响产品下一步方向。

### 产品闭环理解

1. 你能否用自己的话描述 TrustOS 的核心产品闭环？  
   > (Observe → Assess → Control → Evidence → Verify)

2. 你在哪个环节感到最清晰？哪个环节最不清晰？

### 风险评估

3. 你是否理解 low / medium / high 风险级别的含义？
   - [ ] 是，理解
   - [ ] 大致理解但需要更多说明
   - [ ] 不理解

4. 风险评估信号是否让你觉得有用？
   - [ ] 非常有用
   - [ ] 有一定用处
   - [ ] 用处不大

### Dry-Run 控制

5. 你是否清楚理解 TrustOS 当前不实际拦截请求？
   - [ ] 清楚
   - [ ] 不确定

6. 你希望在什么场景下看到真实拦截？（可选）

### 证据导出

7. 证据包的内容是否让你放心？
   - [ ] 放心（只有哈希，不含原始内容）
   - [ ] 希望看到原始内容
   - [ ] 不确定

8. 哈希复核模式是否可接受？
   - [ ] 可接受
   - [ ] 需要更强的证据形式（如签名）

### 整体体验

9. 从 1-10 打分，TrustOS Private Beta 给你多大的信任感？  
   > (1 = 完全不信任, 10 = 完全信任)

10. 你认为 TrustOS 解决的是什么问题？请在以下选择或补充：
    - [ ] AI 输出可追溯性
    - [ ] AI 安全使用治理
    - [ ] AI 调用审查记录 / governance review record
    - [ ] 其他: _______

### 最希望看到的下一步能力 (可多选)

- [ ] 真实的请求拦截 (enforcement)
- [ ] 经过认证的用户/agent 身份
- [ ] 下载证据文件
- [ ] 支持流式请求 (streaming)
- [ ] 多模型路由
- [ ] 团队/多用户协作
- [ ] API 评估端点
- [ ] 其他: _______

### 开放反馈

11. 你在 walkthrough 中遇到任何问题或困惑吗？请描述。

12. 有什么其他建议或反馈？

---

---

## 7. Round 1 Program Documents

以下是为 Private Beta Review Round 1 准备的配套文档：

| Document | Purpose |
|---|---|
| [`private-beta-round-1-plan.md`](./private-beta-round-1-plan.md) | Round 1 目标、reviewer 配置、时间线和判定标准 |
| [`private-beta-reviewer-session-guide.md`](./private-beta-reviewer-session-guide.md) | Reviewer session 操作指南（setup、walkthrough、排错） |
| [`private-beta-observer-checklist.md`](./private-beta-observer-checklist.md) | 内部 observer 记录清单（不引导 reviewer） |
| [`private-beta-feedback-form.md`](./private-beta-feedback-form.md) | 结构化 reviewer 反馈表（评分 + 开放问题） |
| [`private-beta-acceptance-rubric.md`](./private-beta-acceptance-rubric.md) | Round 1 判定标准（PASS / DOC_FIXES / PRODUCT_FIX / BLOCKED） |
| [`private-beta-preflight-validation.md`](./private-beta-preflight-validation.md) | Reviewer session 前的前置验证清单 |
| [`private-beta-round-1-closure-template.md`](./private-beta-round-1-closure-template.md) | Round 1 closure 报告模板 |

其他参考文档：

| Document | Purpose |
|---|---|
| [`private-beta-limitations.md`](./private-beta-limitations.md) | TrustOS 当前支持 / 不支持的能力 |
| [`private-beta-walkthrough.md`](./private-beta-walkthrough.md) | 技术 walkthrough（Gateway 启动、事件、证据） |
| [`private-beta-evidence-interpretation-guide.md`](./private-beta-evidence-interpretation-guide.md) | 证据解读指南 — 面向业务/治理 reviewer 的逐字段解释 |

---

> **Document Status**: Private Beta Handoff — v1.1 (2026-08-04, DF1/DF3/DF4/DF6 applied)  
> **PM Decision**: CHECKPOINT_2 ACCEPTED, Doc Fix Batch AUTHORIZED  
> **Next**: Real reviewer recruitment
