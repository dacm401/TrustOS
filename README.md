# TrustOS — 信息分发架构

> **领导不是因为聪明，是因为信息多。**
> TrustOS 是一个解决"怎么让 AI 的权限和可见信息匹配"的系统。

---

## 核心洞察

**行业在做什么：** 造更强的 AI → 更大模型、更多 context、更强推理

**TrustOS 在做什么：** 造更精准的信息分发层 → 瓶颈从模型能力变成"谁决定给谁看什么"

这不是能力分层，是**信任架构**。

---

## 架构哲学

**少规则 + 强学习 + 必要时请示用户**

```
┌─────────────────────────────────────────────┐
│  Hard Policy（极简红线）                     │
│  密码/账号/密钥/私人数据 → 直接拒绝          │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  Learning Layer（学习层）                    │
│  用户反馈 → 记住 → 下次复用                  │
└─────────────────────────────────────────────┘
                      ↓
┌─────────────────────────────────────────────┐
│  Human-in-the-Loop（用户兜底）              │
│  模糊地带 → 请示用户 → 记入学习层            │
└─────────────────────────────────────────────┘
```

---

## 技术架构：Manager-Worker Runtime

| 组件 | 角色 | 职责 |
|:---|:---|:---|
| **Fast Manager（本地层）** | 判断与分发 | 做判断、分发指令、控制信息流 |
| **Slow Worker（云端层）** | 任务执行 | 执行任务、返回结果 |
| **Task Archive** | 共享工作台 | 跨层传递结构化信息 |

### 四种标准动作

| 动作 | 说明 |
|:---|:---|
| `direct_answer` | Fast 模型直接回复 |
| `ask_clarification` | 请求澄清后再执行 |
| `delegate_to_slow` | 委托 Slow Worker 执行 |
| `execute_task` | 触发执行模式（多步骤） |

### 数据分级

| 分级 | 说明 |
|:---|:---|
| `local_only` | 永不离开本地 |
| `local_summary_shareable` | 脱敏后可上云 |
| `cloud_allowed` | 明确授权后可上云 |

---

## 项目状态

| Phase | 内容 | 状态 |
|:---|:---|:---|
| Phase 0 | ManagerDecision 类型 + Schema 校验 | ✅ 完成 |
| Phase 1 | ManagerDecision MVP + chat.ts 路由 | ✅ 完成 |
| Phase 2 | Worker Prompt 分离 + Task Archive | ✅ 完成 |
| Phase 3 | Local Trust Gateway + 数据分级 | 🚧 进行中 |
| Phase 4 | Permission Layer + Hard Policy | ⏳ 待开始 |
| Phase 5 | 审计归档 + Learning Layer | ⏳ 待开始 |

---

## 快速开始

```bash
git clone https://github.com/dacm401/TrustOS.git
cd TrustOS
cd backend && npm install
cp .env.example .env # 配置 OPENAI_API_KEY
npm run dev
npm run test:r1
```

---

## 相关文档

- `docs/ARCHITECTURE-DESIGN-PRINCIPLES.md` — 架构设计原则
- `docs/lean-agent-runtime-spec.md` — 完整规范
- `docs/MANAGER-DECISION-SCHEMA.md` — 决策 Schema
- `docs/dev-rules.md` — 开发规范

---

## 技术栈

| 类别 | 技术 |
|:---|:---|
| Runtime | TypeScript / Node.js / Hono |
| Database | PostgreSQL + pgvector |
| Models | OpenAI + Anthropic（统一 Provider） |
| Testing | Vitest |
| Frontend | React + TypeScript |

---

## 为什么不是别的方案

| 方案 | 问题 | TrustOS 的回答 |
|------|------|--------------|
| 全上云 | 用户数据暴露，无法控制 | 本地守门，信息按分级流动 |
| 全本地 | 模型能力受限 | 云端只做执行，不持有上下文 |
| Prompt 写死规则 | 脆弱，无法学习 | Learning Layer 从用户反馈中进化 |
| 靠模型自觉 | 不可靠 | Hard Policy 守住红线 |
