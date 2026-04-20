# SmartRouter Pro — 长期架构愿景

> 版本：v1.0 | 日期：2026-04-19 | 状态：**ARCHITECTURE VISION**
> 关联：`CURRENT-PHASE-DIRECTIVE.md` / `PHASE-4-IMPLEMENTATION-PLAN.md`

---

## 1. 愿景一句话版

> **把 AI 系统从"全能黑箱"变成"分权系统"——本地小模型成为"用户利益代理人"，代表用户管理记忆、权限、风险和上下文暴露边界。**

---

## 2. 传统做法 vs 我们的路线

| | 传统做法 | 我们的路线 |
|---|---|---|
| 架构 | 云端大模型 = 全知全能裁判 | 能力强 ≠ 权限大 |
| 上下文 | 全量 history 默认上传 | 本地筛选 → 最小暴露上云 |
| 记忆 | 每次重新认识用户 | 本地档案持续学习用户 |
| 安全 | 模型自身判断 | 规则引擎 + Policy 约束 + 审计 |
| 信任 | 用户信任模型公司 | 用户信任本地层可见边界 |

---

## 3. 三层架构

### Layer 1：本地信任网关（Local Trust Gateway）

**组成**：规则引擎 + 小模型 + Policy Engine

**职责**：
- 保管用户长期档案（偏好/风格/授权习惯/设备知识）
- 对外发请求做最小化裁剪
- 对云端请求做脱敏 / 筛选
- 对危险授权请求做预审
- 对云端返回结果做二次检查
- 管理授权状态与审计日志

**关键原则**：这层不做"唯一安全裁决"，而是"风险初筛 + Policy 执行 + 审计记录"。

### Layer 2：云端能力引擎（Cloud Capability Engine）

**职责**：
- 深推理 / 高质量生成 / 复杂分析 / 工具规划

**限制（强制）**：
- 默认只看任务摘要
- 不默认看本地全量档案
- 访问敏感能力必须走本地审批

### Layer 3：执行与权限层（Execution & Permission Layer）

**职责**：
- 文件访问 / 网络访问 / 外部 API 调用
- shell / code / repo 操作 / 浏览器自动化

**原则**：capability-based permissions / least privilege / explicit approval / revocable grants / full audit trail

---

## 4. 数据分级规范（三类）

| 级别 | 内容 | 上云策略 |
|------|------|---------|
| **local_only** | 全量历史 prompt / 本地文件原文 / 授权记录 / 敏感身份信息 | 绝不上云 |
| **local_summary_shareable** | 项目背景摘要 / 用户偏好摘要 / 任务状态摘要 | 本地摘要后上云 |
| **cloud_allowed** | 当前问题 / 非敏感任务信息 / 公开资料 | 可直接发给云端 |

---

## 5. 为什么本地小模型不能被神化

本地小模型可以做：
- 初筛 / 分类 / 风险提示 / 授权拦截建议
- 用户习惯理解 / 本地档案检索 / 上下文压缩

本地小模型**不能**做：
- 高精度复杂安全判断（推理能力有限）
- 唯一安全裁决（本身也可能被 prompt injection 影响）
- 在没有 policy engine 约束下裸奔

**正确做法**：规则引擎 + 小模型 + policy engine 组合。本地模型是 policy assistant，不是唯一 gatekeeper。

---

## 6. 落地顺序原则

> **先建立边界，再增强智能。先做 Local Security Runtime，再做 Local AI Guard。**

Phase 4.1 → 数据分级 + 权限分层（最底层）
Phase 4.2 → 规则引擎 + redaction + audit（可观测）
Phase 4.3 → 小模型辅助接入验证（增量价值验证）
Phase 5 → 本地档案 + 长期代理（长期目标）

详见 `PHASE-4-IMPLEMENTATION-PLAN.md`。

---

## 7. 与现有架构的演进关系

现有架构已具备：
- Manager-Worker Runtime（Phase 3.0）
- Task Archive 共享工作台
- Evidence / Memory 层
- Guardrail / ToolGuardrail

演进为：
- **Local Trust Gateway** = 现有 Guardrail + Memory + Policy + Audit 合并升级
- **Cloud Capability Engine** = 现有 Manager-Worker Runtime 受数据分级约束
- **Execution Layer** = 现有 ToolGuardrail + ExecutionLoop 规范化

这不是另起炉灶，是**顺着现有架构往上长**。

---

## 8. 禁止方向

- 把本地小模型当万能安全裁判
- 过早承诺"完全本地智能代理"
- 先做花哨本地 UI，权限体系没立住
- 让云端大模型继续默认吃全量历史

---

_愿景日期：2026-04-19 | by 蟹小钳 🦀_
