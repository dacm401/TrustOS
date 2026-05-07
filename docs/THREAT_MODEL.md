# TrustOS 威胁模型与 Fail-Open 策略

> 版本：1.0 | 日期：2026-05-07 | 作者：TrustOS Core

---

## 1. 背景

TrustOS 采用四层 Gated Delegation 架构（G1→G4）和 Learning Layer（记忆检索增强路由）。  
关键路径上有多处 **fail-open 设计**：当某个子系统不可用时，系统不阻断请求，而是降级为安全默认行为继续运行。

本文档回答："挂了谁？挂了怎么办？会不会出安全问题？"

---

## 2. Fail-Open 点清单

### 2.1 Learning Layer（记忆检索）

| 项目 | 说明 |
|---|---|
| **位置** | `src/services/llm-native-router.ts` — `retrieveMemoriesHybrid()` |
| **挂掉场景** | DB 连接超时、memory_entries 表不存在、混合检索异常 |
| **fail-open 行为** | 捕获异常，`console.warn`，继续路由（不注入记忆上下文） |
| **风险等级** | 低 |
| **分析** | 记忆层只是路由增强信号，不是强制约束。挂掉后 G1~G3 门控仍然工作，LLM 直接输出分数，路由结果略微退化但不错误。 |
| **监控建议** | 记录 `memory_retrieval_failed` 指标，持续失败超过 5 分钟触发告警 |

### 2.2 Permission Layer（G4 权限检查）

| 项目 | 说明 |
|---|---|
| **位置** | `src/services/llm-native-router.ts` — phase4 Permission 块 |
| **挂掉场景** | Phase4 模块 import 失败、DataClassifier 异常 |
| **fail-open 行为** | `console.warn`，跳过权限检查，继续委托 |
| **风险等级** | **中** |
| **分析** | 权限检查挂掉会导致本应被 redact 的数据直接发给云端模型。但此层目前只做日志+提示，不是强制执行层（`reject` 分支存在但依赖 permission.fallbackAction 配置）。 |
| **缓解措施** | 如需强制：将 `config.permission.enabled = true` + `fallbackAction = "reject"` 改为在 permission 模块抛出，而非 warn |
| **监控建议** | 记录 `permission_check_skipped` 事件 |

### 2.3 TaskArchive 写入（Phase 3.0）

| 项目 | 说明 |
|---|---|
| **位置** | `src/services/llm-native-router.ts` — TaskArchiveRepo.create 块 |
| **挂掉场景** | DB 写入失败（连接池满、磁盘满）|
| **fail-open 行为** | `console.warn`，`archiveRecord = null`，继续返回 SSE |
| **风险等级** | 低（功能降级，不安全降级）|
| **分析** | Archive 不存在时用户可以收到回复，但后续 SSE poller 会 404，前端会超时提示。任务数据丢失，但不危险。 |
| **缓解措施** | 写入失败时同步返回 `archive_create_failed` 错误码（已在 chat.ts 实现） |

### 2.4 委托日志写入（DelegationLogRepo.save）

| 项目 | 说明 |
|---|---|
| **位置** | `src/services/llm-native-router.ts` — DelegationLogRepo.save 调用 |
| **挂掉场景** | DB 写入失败 |
| **fail-open 行为** | 用 `.catch()` 捕获，`console.error`，不阻断响应 |
| **风险等级** | 低（数据损失，不影响用户） |
| **分析** | 委托日志缺失会影响 Dashboard 统计和 Phase 5.4 的 triggerRate 分析，但不影响路由功能。 |
| **监控建议** | 持续写入失败 > 10 次/分钟触发告警 |

---

## 3. 不能 Fail-Open 的点

以下路径**必须**失败时抛出，不允许静默降级：

| 路径 | 原因 |
|---|---|
| `updateStateWithIntegrity()` | 状态机完整性校验，挂了宁可 archive 保持 running 也不写 failed |
| `parseGatedDecision()` — schema_version 校验 | 协议违规必须写 `state=failed` + `protocol_violation=true`，不允许当 direct_answer 静默通过 |
| `assertUnreachable()` | 加新 decision_type 时必须编译期报错，不允许运行时 fallback |

---

## 4. 整体风险评估

| 维度 | 评级 | 说明 |
|---|---|---|
| 可用性 | 高 | 多处 fail-open 保证核心路由在子系统故障时不中断 |
| 数据完整性 | 中 | 日志/Archive 写入可能丢失，影响分析但不影响功能 |
| 安全性 | 中 | Permission Layer fail-open 是主要风险点，目前依赖配置控制 |
| 可观测性 | 中 | fail-open 事件有 console.warn/error，但缺乏结构化指标 |

---

## 5. 后续行动项

| 优先级 | 行动 | Owner |
|---|---|---|
| P1 | Permission Layer 从 fail-open 改为 fail-closed（生产环境 `reject` 分支强制执行） | Sprint N+1 |
| P2 | 结构化埋点：fail-open 事件写 delegation_logs.error_metadata 字段 | Sprint N+2 |
| P2 | 告警规则：memory_retrieval_failed 持续 5min + delegation_log_write_failed > 10/min | Sprint N+2 |
| P3 | `delegation_logs` 补充缺失字段（cost_saved_vs_slow / exec_input_tokens / selected_role）| 独立 sprint |
