# TrustOS 当前状态（会话恢复卡片）

> **用途**：新会话/上下文压缩后，**先读这一个文件**即可恢复工作上下文。
> 详细历史见 `TRST-execution-log.md`（3828+ 行，按时间追加）。
> **维护约定**：每完成一批重要工作，必须更新本文件（见文末「维护约定」）。

*最后更新：2026-08-29*

---

## 1. 基本信息

| 项 | 值 |
|---|---|
| 分支 | `feature/trst-3-private-beta-readiness` |
| 定位 | 个人 PC 操作系统（本地 OS，单用户）；先服务愿自己跑容器的极客 |
| 运行时 | Docker Compose 全栈（frontend :3000 / backend :3001 / gateway :8787 / postgres / redis / minio / prometheus） |
| 登录 | `admin` / `changeme`（`.env` 的 `AUTH_USERS`） |
| LLM 上游 | SiliconFlow `deepseek-ai/DeepSeek-V4-Flash` |

## 2. 最近 commit（时间倒序）

| Commit | 内容 |
|---|---|
| `2a88f0d` | docs: RFC-001 本地优先存储 + Memory 增量蒸馏设计（待拍板） |
| `9320976` | feat(egress): **ADR-001 护栏重述** — 本地优先存储 + 外发强制加工 |
| `b1380d2` | docs: 系统回顾文档更新（第二轮 P1-P2 完成） |
| `945ca73` | feat: 第二轮 P1-P2（Assessment 增强 / Bundle 签名 / 索引去 native） |
| `d339fa1` | fix(trust): P0-P2 架构断链修复（Event Backbone / 哈希链 / Gateway / Control / Audit） |
| `7e6a0cd` | docs: 系统全景回顾与主流 Agent 对比分析 |
| `a7929b7` | chore: 前端防御改进（EvidencePanel 重试 + 网关离线守卫） |
| `1e01a83` | fix: 聊天 401（补 Authorization 头）+ API fallback 端口 3002→3001 |
| `1cbcc44` | fix: 首页 client-side exception（补 QueryClientProvider） |

⚠️ **全部未 push**（github.com:443 网络阻断），待网络恢复后一并推送。

## 3. 已完成的关键工作（2026-08-26 ~ 08-29）

### 3.1 稳定性修复（用户报告驱动）
- **首页 client-side exception**（`Application error`）
  根因：`app/providers.tsx` 缺 `QueryClientProvider`，5F2 的 `React.lazy` 视图调 `useQuery` 时整页崩溃。
  修复：在 Providers 包裹 `QueryClientProviderWrapper`。
- **聊天返回"处理您的请求时出现了问题"**
  根因①：`docker-compose.yml` 硬写旧模型 `Qwen/Qwen2.5-*`，覆盖 `.env` 的 deepseek。
  根因②：`ChatInterface` 调 `/api/chat` **只带 `X-User-Id` 不带 `Authorization`** → 401。
  修复：模型改由 `.env` 控制；两个发送路径补 `Bearer` 头。

### 3.2 信任架构：P0-P2 断链修复（**系统回顾分析后发现**）
详见 `trst-system-review-and-competitive-analysis-2026-08-28.md` §6-§8。

| 断链 | 根因 | 结果 |
|---|---|---|
| Event Backbone 主后端写不进 | `initEventStore()` 仅被 Gateway 脚本调用，`src/index.ts` 从未调用 | ✅ enforcement 事件真实落盘 |
| Evidence 无哈希链 | 只有逐条哈希，无 `prev_hash` → **无法发现删除** | ✅ 加链 + 验证器，14/14 |
| Gateway 未部署 | compose 无该服务；且 `better-sqlite3` SIGSEGV（exit 139） | ✅ 部署 + 改**纯 JS 索引**消除 native 依赖 |
| Control 永不拦截 | ①`buildEngine` 传 `classifier=undefined` ②规则集受 `dlpEnabled` 控制默认空数组 | ✅ 规则真实命中，`can_block:true` |
| Audit UI 为 fixture | 渲染 4 个静态样例 | ✅ 接 `GET /v1/human-review` 真实数据 |
| Assessment 信号浅 | 12 信号全基于元数据 | ✅ 18 信号，含链完整性（**可检测删除**） |
| Evidence Bundle 仅前端 | 剪贴板导出，`signed:false` | ✅ 后端化 + HMAC 签名 + 验证端点 |

### 3.3 护栏重述（ADR-001，Boss 决策）
旧护栏「raw content 不落库」→ **新护栏**：
- **入**：本地优先，原始 prompt 存本机
- **出**：**发往云端必须加工**（已实现）
- 证据链仍仅哈希

已实现「出」侧：`src/services/egress/egress-processor.ts`

## 4. 当前待办

| 状态 | 事项 |
|---|---|
| 🔴 **待 Boss 拍板** | **RFC-001「入」侧实施**（5 个决策点：加密方案 / L2 是否做 / 保留期 / 低置信度处理 / 是否回溯历史） |
| 🟡 待网络恢复 | push 全部本地 commit（github.com:443 阻断） |
| 🟢 可随时做 | 更新 `TRST-0` 文档中的旧护栏表述（ADR-001 已变更，原文未同步） |

## 5. 验证入口

```bash
npm run verify:trust
```

| 组 | 断言数 | 覆盖 |
|---|---|---|
| `verify:chain` | 14 | 哈希链（防篡改/**防删除**/重启恢复） |
| `verify:egress` | 39 | 外发加工（脱敏/裁剪/统计安全） |
| `verify:index` | 39 | 纯 JS 索引契约 |
| `verify:bundle` | 26 | Evidence Bundle 隐私 + 签名 |
| `verify:assess` | 11 | Assessment 新信号 |
| `verify:egress-fp` | 6 | 零误伤 |
| **合计** | **135** | |

## 6. 关键文档索引

| 文档 | 用途 |
|---|---|
| **`CURRENT-STATUS.md`**（本文件） | 会话恢复入口 |
| `TRST-execution-log.md` | 完整时间线（3828+ 行） |
| `ADR-001-local-first-egress-processing.md` | 护栏重述决策 |
| `RFC-001-local-memory-distillation.md` | 本地存储 + Memory 蒸馏设计（待拍板） |
| `trst-system-review-and-competitive-analysis-2026-08-28.md` | 系统全景 + 竞品对比 + 诚实评估 |
| `TRST-0-trustos-architecture-thesis.md` | 战略基线（⚠️ 护栏表述已被 ADR-001 变更，待同步） |
| `TRST-5-charter-draft.md` | TRST-5 章程 |

## 7. 环境注意事项（踩过的坑）

| 坑 | 说明 |
|---|---|
| PowerShell 编码（**高危**） | `Set-Content` / `Add-Content -Encoding utf8` 在 PS 5.1 会造成**双重编码乱码**（尤其含中文时），且会真实损坏文件。改用 `[System.IO.File]::WriteAllText/AppendAllText($p, $t, [System.Text.UTF8Encoding]::new($false))` |
| PowerShell 编码（BOM） | 即便用对 API，`Set-Content` 也可能写 BOM，导致签名验证**假失败**；验证请用 node 脚本 |
| PowerShell 多行字符串 | 含中文的多行 commit message 会解析失败；改用 `git commit -F <file>` |
| 中文 commit message | 终端回显乱码属正常（git 内存储正确），不必据此判断失败 |
| `NEXT_PUBLIC_*` | 只在 **build 阶段**固化；compose 的 `environment:` 对运行时无效，必须用 `build.args` |
| `better-sqlite3` | `npm install --ignore-scripts` 会跳过 prebuild → `require()` 时 SIGSEGV（exit 139，try/catch 无法捕获） |
| Windows curl | IPv6 怪癖导致误报 UNREACHABLE；用 `netstat` 或 `Invoke-WebRequest` 确认 |
| 双进程写同一 JSONL | 会交错损坏哈希链；遵循 single-writer，每个 writer 独立日志文件 |

---

## 维护约定

**何时更新本文件**：
1. 完成一批 commit 后
2. 做出架构/护栏决策后
3. 发现环境坑后（写入 §7）
4. 待办状态变化时（§4）

**原则**：
- 文档是**跨会话的持久记忆**——上下文会被压缩，文档不会
- 记录**为什么**（决策依据），不只是**做了什么**
- 诚实记录坏处与局限，不制造虚假安全感
