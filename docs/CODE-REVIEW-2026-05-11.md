# TrustOS 全面代码审查与改进方案

> 日期：2026-05-11 | 审查范围：前端 + 后端路由引擎 + Gating 子模块 + 测试覆盖

---

## 一、前端 React 组件审查

### 架构概况
- Next.js 14 + TypeScript + Tailwind CSS，33 个 .tsx 文件
- 三栏布局：Sidebar(52px) + 主区域(自适应) + 工作台(384px)
- View 切换用 CSS display:none 保持状态

### P0 问题（立即修复）

| # | 问题 | 位置 | 修复方案 |
|---|------|------|---------|
| F-01 | DecisionCard 引号语法错误 | DecisionCard.tsx:163 | 修复 `var(--border-subtle)\"` → `var(--border-subtle)"` |
| F-02 | DebugPanel 类型不一致 | DebugPanel.tsx:58 | `setData(undefined)` → `setData(null)` |
| F-03 | API Key 明文存 localStorage | SettingsModal.tsx | 改用 httpOnly cookie 或后端代理 |

### P1 问题（短期改进）

| # | 问题 | 修复方案 |
|---|------|---------|
| F-04 | React Query 引入但几乎未用 | 统一 Workbench 面板使用 React Query hooks |
| F-05 | relativeTime() 重复定义 3 次 | 提取到 lib/utils.ts |
| F-06 | SOURCE_CONFIG/TYPE_CONFIG 重复 | 提取到共享常量模块 |
| F-07 | 大量 any 类型 | 定义 ManagerDecision/Message 等具体接口 |
| F-08 | fetch 无 AbortController | 添加请求取消机制 |
| F-09 | SettingsModal 硬编码白色主题 | 改用 CSS 变量主题系统 |
| F-10 | handleSend/handleSendWithText 重复 | 合并为共用函数 |

### P2 问题（中期重构）

| # | 问题 | 修复方案 |
|---|------|---------|
| F-11 | page.tsx 承担过多顶层状态（6 个 useState） | 引入 Context Provider |
| F-12 | ChatInterface 9 个 useState | 重构为 useReducer |
| F-13 | TasksView 内联重复实现 TracePanel/EvidencePanel | 复用现有组件 |
| F-14 | pollDelegation 和 SSE 流式功能重复 | 统一为单一机制 |
| F-15 | ErrorBoundary fallback={null} | 提供有意义的 fallback UI |

---

## 二、后端 llm-native-router.ts 审查（1309 行）

### 架构概览
```
用户请求 → callManagerModel(并行 Memory 检索)
         → parseGatedDecision (解析 JSON)
         → runGatedDelegation (G1→G2→G3)
         → 强制委派覆盖 (execScore > 0.75)
         → routeByDecision (分发到 4 种动作)
         → delegation_log_id 生成 + 日志写入
```

### P0 问题

| # | 问题 | 行号 | 修复方案 |
|---|------|------|---------|
| R-01 | delegate/execute 重复 ~100 行 | 947-1283 | 抽取 `handleDelegation()` 公共函数 |
| R-02 | fire-and-forget 静默吞错 | 多处 | 改为 console.error + 结构化指标 |

### P1 问题

| # | 问题 | 行号 | 修复方案 |
|---|------|------|---------|
| R-03 | callManagerModel/callDirectReplyModel 重复 | 457-572 | 合并为 `callModelWithPrompt()` |
| R-04 | Magic numbers 未配置化 | 479,375,706-707 | 提取到 config.ts |
| R-05 | splitManagerOutput 贪婪正则 | 580-616 | 改用非贪婪匹配或 JSON parser |
| R-06 | 动态 import 在每次请求执行 | 1059,1082 | 顶层 import |

### P2 问题

| # | 问题 | 修复方案 |
|---|------|---------|
| R-07 | parseGatedDecision 内 catch 吞掉 JSON.parse 异常 | 区分 PROTOCOL_VIOLATION 和 parse 失败 |
| R-08 | 降级检测逻辑（行 418-432）额外调用 LLM | 考虑缓存或预判 |

---

## 三、Gated Delegation 子模块审查

### 3.1 system-confidence.ts（G1）

**算法**：基础 = hint×0.4 + gap×0.6，然后乘法惩罚链

**问题**：
| # | 问题 | 严重度 | 修复方案 |
|---|------|--------|---------|
| G1-01 | 惩罚系数硬编码（0.85/0.92/0.80） | P1 | 移入 gating-config.ts |
| G1-02 | 乘法链式叠加可能过度惩罚 | P2 | 设衰减下限（如 0.3） |

### 3.2 policy-calibrator.ts（G2）

**算法**：Clarification 成本 → KB 校准 → Cross-session 兜底 → 硬规则 → 阈值过滤

**问题**：
| # | 问题 | 严重度 | 修复方案 |
|---|------|--------|---------|
| G2-01 | Cross-session boost +0.30 硬编码 | P1 | 移入 config |
| G2-02 | original_score 记录不准确 | P2 | 记录 LLM 原始分数 |

### 3.3 delegation-reranker.ts（G3）

**算法**：Gray zone 短路 → gap/conf/高成本触发 → 规则式 rerank

**问题**：
| # | 问题 | 严重度 | 修复方案 |
|---|------|--------|---------|
| G3-01 | 阈值 0.70 与设计文档 0.75 不一致 | P1 | 确认是否有意调整 |
| G3-02 | Gray zone 可能跳过本应 rerank 的场景 | P2 | 添加 gap 极小时的例外 |

### 3.4 gating-config.ts

**关键发现**：
- `delegate_to_slow` 阈值 = 0.65（代码） vs 0.75（设计文档拍板值）
- `cost_penalty` 定义了但未使用
- `high_cost_confidence_floor` = 0.70 vs 设计文档 0.75

### 3.5 knowledge-boundary-signals.ts（KB-1）

**问题**：
| # | 问题 | 严重度 | 修复方案 |
|---|------|--------|---------|
| KB-01 | 2 个 signalType 是死代码 | P2 | 移除或添加对应 pattern |
| KB-02 | 正则 `.*` 可能误命中 | P2 | 收窄匹配条件 |

### 3.6 sensitive-data-rule.ts

**问题**：
| # | 问题 | 严重度 | 修复方案 |
|---|------|--------|---------|
| SD-01 | 未被 gating pipeline 调用 | P1 | 确认调用链，补充到 G2 |
| SD-02 | 15 位数字可能误杀时间戳 | P2 | 增加上下文判断 |

---

## 四、测试覆盖分析

### 现状
- 总测试文件：62 个
- 纯单元测试：~25 个
- Repository 集成测试：~11 个
- API 集成测试：~10 个

### P0 缺口（修正后）

| # | 缺口 | 说明 |
|---|------|------|
| T-01 | llm-native-router.ts 主路由流程 | 核心路由决策函数无单元测试 |
| T-02 | Phase 3 委托执行层 | slow-worker-loop/execute-worker-loop/sse-poller 全无测试 |
| T-03 | model-gateway.ts | 所有 LLM 调用必经之路无测试 |

### P1 缺口

| # | 缺口 | 说明 |
|---|------|---------|
| T-04 | prompt-assembler.ts | Prompt 质量直接影响路由准确性 |
| T-05 | memory-retrieval.ts | 跨会话记忆检索无验证 |
| T-06 | split-manager-output.test.ts 白盒复制 | 与源码不同步风险高 |

### 建议测试用例

**llm-native-router.ts（P0）**：
1. 直接问答路径：mock LLM → verify 不触发委托
2. 委托路径：mock LLM → verify archive/command 写入
3. 执行路径：mock LLM → verify TaskPlanner.plan 调用
4. 澄清路径：mock LLM → verify ClarifyQuestion 生成
5. 非法 JSON → verify fallback 到 direct_answer
6. CircuitBreaker 触发 → verify 降级响应
7. Phase 4 redaction 集成 → verify 脱敏执行
8. 强制委派覆盖 → verify execScore > 0.75 时强制路由

**Phase 3（P0）**：
1. slow-worker-loop：mock 轮询 → verify 进度更新+最终结果
2. execute-worker-loop：mock tool 执行 → verify 状态机转换
3. sse-poller：mock HTTP stream → verify 事件解析+超时

**model-gateway.ts（P1）**：
1. callModelFull：mock 响应 → verify 格式标准化
2. Provider fallback：主 provider 失败 → verify 切换
3. Circuit breaker：连续失败 → verify 熔断

---

## 五、综合改进方案（按优先级排序）

### Sprint 51 轨道 D：代码质量收口

| 序号 | 任务 | 工作量 | 收益 |
|------|------|--------|------|
| 1 | 修复前端 P0（F-01/F-02/F-03） | 0.5 天 | 消除语法错误+安全风险 |
| 2 | 抽取 delegate/execute 公共逻辑（R-01） | 1 天 | 减少 100 行重复，降低 bug 风险 |
| 3 | fire-and-forget → 结构化日志（R-02） | 0.5 天 | Dashboard 数据可靠性 |
| 4 | 魔术数字配置化（R-04/G1-01/G2-01） | 0.5 天 | 支持运行时调优 |
| 5 | 阈值对齐：代码 vs 设计文档（G3-01） | 0.5 天 | 消除文档-代码不一致 |

### Sprint 52 轨道 E：测试补齐

| 序号 | 任务 | 工作量 | 收益 |
|------|------|--------|------|
| 6 | llm-native-router.ts 主流程单元测试（8 个用例） | 2 天 | 核心路由有测试保护 |
| 7 | Phase 3 委托执行层测试（4 个用例） | 1.5 天 | 委托链路有测试保护 |
| 8 | model-gateway.ts 测试（3 个用例） | 1 天 | LLM 调用层有测试保护 |
| 9 | split-manager-output 改为 import 测试 | 0.5 天 | 消除白盒复制风险 |

### Sprint 52 轨道 F：前端重构

| 序号 | 任务 | 工作量 | 收益 |
|------|------|--------|------|
| 10 | React Query 统一（F-04） | 1 天 | 消除两套数据获取模式 |
| 11 | 提取重复代码（F-05/F-06） | 0.5 天 | DRY |
| 12 | TypeScript 类型安全（F-07） | 1 天 | 消除 any，提升可维护性 |

### Sprint 53+ 轨道 G：架构优化

| 序号 | 任务 | 工作量 | 收益 |
|------|------|--------|------|
| 13 | Context Provider 引入（F-11） | 1 天 | 消除 prop drilling |
| 14 | ChatInterface useReducer 重构（F-12） | 1.5 天 | 状态管理清晰化 |
| 15 | 合并 callManagerModel/callDirectReplyModel（R-03） | 0.5 天 | DRY |
| 16 | Permission Layer fail-open → fail-closed | 0.5 天 | 安全加固 |

---

## 六、风险矩阵

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| delegate/execute 代码重复导致 bug 遗漏 | 高 | 中 | 抽取公共函数 |
| 阈值漂移（文档 vs 代码）导致路由不准 | 中 | 高 | 自动化校验测试 |
| 测试缺口导致核心路由回归 | 中 | 高 | 优先补齐 P0 测试 |
| 前端语法错误导致白屏 | 低 | 高 | 立即修复 |
| API Key 泄露 | 低 | 高 | 改用安全存储 |

---

_审查完成：2026-05-11 | 共发现 42 个问题（P0: 5, P1: 16, P2: 21）_
