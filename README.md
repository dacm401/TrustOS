# TrustOS — 信任操作系统

> **不是让 AI 更聪明，是让 AI 的权限和可见信息匹配。**
> 
> 云端模型只知道它该知道的。本地层负责记忆、权限和信任边界。

---

## 核心定位

TrustOS 是一个**本地信任层 + 云端执行层**的混合 AI 架构。

**核心洞察：**
> 领导不是因为聪明才当领导，是因为信息多。

信息分发权才是 AI 系统的核心权力，而不是推理能力。

---

## 架构原则

### 1. 本地层 = 信息守门人
- 用户私域档案只存在本地
- 云端请求必须经过本地层裁剪/脱敏
- 敏感字段默认不上云

### 2. 云端 = 执行单元
- 只接收任务指令（Task Command）
- 只知道完成工作所需的最小信息
- 不持有用户上下文

### 3. 本地模型的价值 = 信息控制权
- 不依赖本地模型的推理能力
- 依赖本地层掌握完整信息视图
- 决定什么发给云端、什么留在本地

### 4. 默认轻，按需升级
- 能直接回答 → 不走重路径
- 能澄清 → 不提前深推理
- 能局部委托 → 不全链路升级

---

## 技术架构

### Manager-Worker Runtime
- **Fast Manager（本地层）**：做判断、分发指令、控制信息流
- **Slow Worker（云端层）**：执行任务、返回结果
- **Task Archive**：共享工作台，跨层传递结构化信息

### 四种标准动作
| 动作 | 说明 |
|------|------|
| `direct_answer` | Fast 模型直接回复 |
| `ask_clarification` | 请求澄清后再执行 |
| `delegate_to_slow` | 委托 Slow Worker 执行 |
| `execute_task` | 触发执行模式（多步骤） |

### 数据分级
| 分级 | 说明 |
|------|------|
| `local_only` | 永不离开本地 |
| `local_summary_shareable` | 脱敏后可上云 |
| `cloud_allowed` | 明确授权后可上云 |

---

## 项目状态

### Phase 0 — 路线收口 ✅
- [x] ManagerDecision 类型定义
- [x] Schema 校验层 + fallback
- [x] Task Archive 四张表（task_archives / commands / worker_results / events）
- [x] 单元测试 14/14 通过

### Phase 1 — ManagerDecision MVP
- [ ] chat.ts 接入四种动作分支
- [ ] SSE 新事件（manager_decision / worker_started / worker_completed）
- [ ] 旧 router 保留 fallback

### Phase 2 — Worker 化
- [ ] Prompt Assembler 分层（Manager Prompt / Worker Prompt）
- [ ] Slow Worker 不再读取全量 history

### Phase 3 — Local Trust Gateway
- [ ] 数据分级规范
- [ ] Policy 接口骨架
- [ ] 审计日志

---

## 快速开始

```bash
# 克隆
git clone https://github.com/dacm401/TrustOS.git
cd TrustOS

# 安装依赖
cd backend && npm install
cp .env.example .env  # 配置 OPENAI_API_KEY

# 启动
npm run dev

# 测试
npm run test:r1
```

---

## 文档

- [Lean Agent Runtime Spec](./docs/lean-agent-runtime-spec.md)
- [Manager Decision Schema](./docs/MANAGER-DECISION-SCHEMA.md)
- [Next Phase Plan](./docs/next-phase-plan.md)
- [开发规范](./docs/dev-rules.md)

---

## 技术栈

- **Runtime**: TypeScript / Node.js / Hono
- **Database**: PostgreSQL + pgvector
- **Models**: OpenAI + Anthropic（统一 Provider）
- **Testing**: Vitest
- **Frontend**: React + TypeScript
