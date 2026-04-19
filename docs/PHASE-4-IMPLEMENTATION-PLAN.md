# SmartRouter Pro — Phase 4 实施路线

> 版本：v1.0 | 日期：2026-04-19 | 状态：**PHASE 4 PLANNED — Sprint 40+**
> 关联：`ARCHITECTURE-VISION.md`（愿景）/ `CURRENT-PHASE-DIRECTIVE.md`（当前指令）
> 前置条件：Sprint 39 Runtime Validation & Stabilization 验收通过

---

## 1. 定位

本文档定义 Phase 4 的分阶段实施路线。

Phase 4 的目标是：**在 Manager-Worker Runtime 验收完成的基础上，建立 Local Trust Gateway 的最底层——数据分级、权限边界、审计与最小暴露原则。**

> **核心原则：先建立边界，再增强智能。先做 Local Security Runtime，再做 Local AI Guard。**

---

## 2. Phase 4 总览

| 子阶段 | 名称 | Sprint | 核心目标 |
|--------|------|--------|----------|
| Phase 4.1 | 数据分级 + 权限层基础 | Sprint 40 | 定义三类数据 / outbound 脱敏 hook / audit 骨架 |
| Phase 4.2 | 规则引擎 + 审批机制 | Sprint 41 | 高风险工具调用审批 / policy engine 接口 / audit 事件 |
| Phase 4.3 | 小模型辅助接入验证 | Sprint 42 | 小模型在 risk-classification / context-compression 的增量价值验证 |
| Phase 5 | 本地档案 + 长期代理 | Sprint 43+ | 本地用户档案 / 习惯学习 / 长期代理（长期目标） |

---

## 3. Phase 4.1：数据分级 + 权限层基础

**Sprint 40 | P0**

### 3.1 三类数据分级定义

在数据库和代码中正式定义三类数据：

```typescript
enum DataClassification {
  LOCAL_ONLY = 'local_only',           // 绝不上云
  LOCAL_SUMMARY_SHAREABLE = 'local_summary_shareable', // 本地摘要后上云
  CLOUD_ALLOWED = 'cloud_allowed'     // 可直接发给云端
}
```

**LOCAL_ONLY（绝不暴露）**：
- 用户全量历史 prompt / conversation
- 本地文件原文内容
- 授权决策记录（谁授权了什么）
- 敏感身份信息（密码 / token / API key）
- 本地档案全文

**LOCAL_SUMMARY_SHAREABLE（摘要后上云）**：
- 项目背景摘要（由本地模型压缩）
- 用户偏好摘要
- 任务状态摘要
- Archive task brief（轻量摘要版）

**CLOUD_ALLOWED（可直接上云）**：
- 当前用户问题（非敏感版）
- 公开资料检索结果
- 已脱敏的技术文档片段
- ManagerDecision action type

### 3.2 Outbound Request 脱敏 Hook

在所有 outbound request（发给 SiliconFlow / 外部 API）路径上埋 redaction hook：

```
 outbound-request
       ↓
 [redaction-hook] → 判断字段分类 → 脱敏 / 拒绝 / 直接放行
       ↓
  actual request
```

Scope：
- SiliconFlow 请求的 messages / system prompt 字段
- 外部 web_search 请求的 query 字段
- 任何包含 file_path / user_identity / token 的字段

目标：**不求完美，先求可观测**——先让 redaction 有记录，日后可逐步调优规则。

### 3.3 Audit 骨架

最少覆盖：
- `audit_events` 表（event_type / actor / resource / action / timestamp / metadata JSONB）
- 写事件：redaction-triggered / sensitive-field-detected / request-blocked / approval-requested
- 读事件：archive-accessed / history-accessed / evidence-retrieved

### 3.4 交付物

- `docs/DATA-CLASSIFICATION-SPEC.md`（三类数据正式定义）
- `types/data-classification.ts`（enum + 分类注解工具）
- `services/redaction-hook.ts`（outbound request 脱敏中间件）
- `migrations/011_audit_events.sql`（audit_events 表）
- E2E：验证带 LOCAL_ONLY 字段的请求确实被脱敏或拦截

### 3.5 收口标准

- [ ] 三类数据分类在代码中有明确注解
- [ ] outbound request 可被脱敏 hook 拦截并记录
- [ ] audit_events 表可写入 redaction-triggered 事件
- [ ] E2E 验证：敏感字段上云前被处理（不是完美处理，而是有日志记录）

---

## 4. Phase 4.2：规则引擎 + 审批机制

**Sprint 41 | P1**

### 4.1 Policy Engine 接口

定义 policy engine interface，所有高风险操作必须过 policy check：

```typescript
interface PolicyCheckRequest {
  action: string;           // 'file_write' | 'http_request' | 'shell_exec' | ...
  resource: string;         // '/Users/xxx/Desktop/' | 'https://api.twitter.com/...'
  user_id?: string;
  context: Record<string, unknown>;
}

interface PolicyCheckResult {
  verdict: 'allow' | 'deny' | 'ask'; // ask = 需要用户审批
  reason?: string;
  conditions?: string[];   // 附加条件，如 "require_user_confirm"
}
```

### 4.2 高风险工具审批流程

针对以下高风险动作，强制进入审批状态：

| 风险动作 | 默认 verdict | 用户响应超时 |
|---------|-------------|------------|
| shell_exec | ask | 60s |
| http_request（外部） | ask | 30s |
| file_write（系统目录） | ask | 60s |
| file_delete | deny（除非白名单） | — |
| outbound_email / webhook | deny（除非白名单） | — |

### 4.3 Audit 事件扩展

扩展 audit_events 覆盖：
- policy_check_passed / policy_check_denied / policy_check_approved / policy_check_rejected
- archive_written / worker_result_received / sensitive_data_accessed

### 4.4 交付物

- `types/policy.ts`（PolicyCheckRequest / PolicyCheckResult）
- `services/policy-engine.ts`（基础实现 + 默认规则集）
- `services/approval-manager.ts`（审批状态管理：pending / approved / rejected）
- 工具调用路径接入 policy check（至少 http_request / shell_exec）
- `docs/POLICY-ENGINE-SPEC.md`

### 4.5 收口标准

- [ ] 高风险工具调用必须过 policy engine
- [ ] ask verdict 触发审批状态，用户可 approve/reject
- [ ] 所有 policy check 结果写入 audit_events
- [ ] E2E：验证 http_request 被 policy engine 拦截并记录

---

## 5. Phase 4.3：小模型辅助接入验证

**Sprint 42 | P2**

### 5.1 验证目标

在 Phase 4.1/4.2 边界清晰后，验证本地小模型能否在以下两点产生增量价值：

**验证点 A：Risk Classification**
- 给定一个 outbound request，本地小模型能否比规则引擎更准确地区分风险等级？
- 验证方法：规则引擎 vs 规则+小模型，对比误报率 / 漏报率

**验证点 B：Context Compression**
- 给定用户 long history，本地小模型能否生成高质量的 task brief summary？
- 验证方法：人工评估 + 后续 worker 任务完成率对比

### 5.2 接入原则

- 小模型**不作为唯一决策者**，而是 policy engine 的 advisory 输入
- 小模型输出必须经过 policy engine 约束后才能执行
- 用户可关闭小模型 advisory（纯规则模式）

### 5.3 交付物

- `services/local-model-advisor.ts`（小模型 advisory 接口）
- `services/policy-engine.ts`（增强：接受 local_model_advisory_score 作为输入）
- 验证报告：Risk Classification 误报率 / 漏报率对比数据
- 验证报告：Context Compression 摘要质量人工评估

### 5.4 收口标准

- [ ] 小模型 advisory 输出有日志记录
- [ ] advisory score 接入 policy engine（可配置开关）
- [ ] 验证数据证明小模型产生了增量价值（或证明不值得接入）

---

## 6. Phase 5：本地档案 + 长期代理

**Sprint 43+ | P2 — 长期目标**

### 6.1 目标

让本地模型从"policy advisor"升级为"用户长期代理"：

- 持续学习用户偏好 / 授权习惯 / 风险偏好
- 本地档案自动更新（每次任务完成后）
- 多会话间维持用户理解连续性
- 主动发现异常请求模式

### 6.2 交付物

- `local-archive-repo.ts`（本地用户档案 CRUD）
- `user-profile-service.ts`（偏好学习 + 档案更新逻辑）
- 本地档案 UI（用户可编辑 / 删除 / 导出个人档案）
- 异常请求模式检测（基于历史授权数据）

### 6.3 收口标准

- [ ] 本地用户档案可读 / 可写 / 可删除
- [ ] 用户档案对云端模型不可见（local_only）
- [ ] 多会话间档案持久化
- [ ] 异常请求模式检测有可观测日志

---

## 7. 当前禁止事项

| 禁止 | 原因 |
|------|------|
| 在 Phase 4.1/4.2 边界立稳之前，直接做 Phase 5 | 信任体系未立住，本地模型会裸奔 |
| 让本地小模型在无 policy engine 约束下做安全裁决 | 推理能力有限 + prompt injection 风险 |
| 在没有 audit 骨架的情况下让云端模型默认访问敏感信息 | 违背最小暴露原则 |

---

## 8. 与 Sprint 39 的衔接

Sprint 39 收口后，直接进入 **Sprint 40 Phase 4.1**，不需要额外讨论优先级。

| Sprint 39 收口产物 | Phase 4.1 依赖 |
|-------------------|--------------|
| 权威结果源明确 | outbound request redaction hook 的上游接口 |
| SSE 协议冻结 | audit_events 表的 event schema 参考 |
| 兼容层清单 | legacy table 哪些需要加 redaction hook |

---

_路线日期：2026-04-19 | by 蟹小钳 🦀_
