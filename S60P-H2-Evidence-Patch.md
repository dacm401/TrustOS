# S60P-H2 Evidence Patch — 操作指引

**目标**：通过运行 `scripts/e2e-chat-utf8.mjs`，收集四条 artifact 场景的完整 ledger + security scope 证据，完成 Sprint 60P-H2 收口验收。

---

## 前置条件

### ✅ 服务器环境

```powershell
# 1. 确认最新代码（commit 2e2e248）
cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS
git log --oneline -3
# 应显示：
# 2e2e248 fix(s60p-h2): embed ledger in SSE done event + enhanced UTF-8 harness

# 2. 启动数据库
docker start trustos-postgres-1

# 3. 启动服务器（生产级 180s timeout，保留服务器日志窗口）
$env:REQUEST_TIMEOUT="180000"
$env:API_TIMEOUT="180000"
npx tsx --env-file=.env src/index.ts
```

### ✅ 验证服务器就绪

```powershell
# 新开终端窗口，执行健康检查
curl http://localhost:3001/health
# 期望：{"status":"ok"} 或类似响应
```

---

## 执行流程

### 终端布局

```
┌─────────────────────────────────────────────────────────────┐
│ 终端 1：服务器（保留日志窗口，不要关闭）                        │
│ cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS             │
│ npx tsx --env-file=.env src/index.ts                         │
│                                                              │
│ ← 服务器日志会输出 [CALL_LEDGER] 和 [CALL_LEDGER_WORKER]      │
└─────────────────────────────────────────────────────────────┘
                              ↕ SSE
┌─────────────────────────────────────────────────────────────┐
│ 终端 2：E2E Harness                                          │
│ cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS             │
│ node scripts/e2e-chat-utf8.mjs --host http://localhost:3001 │
└─────────────────────────────────────────────────────────────┘
```

### 执行命令

```powershell
# 标准执行（4 条 artifact 场景）
node scripts/e2e-chat-utf8.mjs --host http://localhost:3001

# 如果需要指定 session（方便 grep 过滤日志）
node scripts/e2e-chat-utf8.mjs --host http://localhost:3001 --session s60p-h2-final

# 查看 help
node scripts/e2e-chat-utf8.mjs --help
```

---

## 期望日志模板

### MSG1：创建登录页（create）

**Harness 端输出**：
```
[MSG1] 帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。
--------------------------------------------------
  Reply   : ```jsx\nimport React, { useState } from 'react';\n...
  TotalMs : xxxxms
  ArtifactId/TaskId: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ┌─ Ledger ─────────────────────────────────────────────
  │  managerCalls=0  workerCalls=1  totalModelCalls=1
  │  Entries:
  │    [worker] deepseek-ai/DeepSeek-V4-Flash  in=xxx out=xxx ms=xxx  cost=$0.00xxxx  known=true(configured)
  │  Security Scope:
  │    artifactToManager = false
  │    artifactToWorker = false        ← 首次 create，无 revision source
  └─────────────────────────────────────────────────────
  Lineage : (new artifact)
```

**服务器日志**：
```
{"msg":"[CALL_LEDGER_WORKER] Worker model call complete","traceId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","archiveId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","taskId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","model":"deepseek-ai/DeepSeek-V4-Flash","modelRole":"worker","inputTokens":xxx,"outputTokens":xxx,"estimatedCost":0.00xxxx,"latencyMs":xxx,"isRevisionTask":false}
{"msg":"[CALL_LEDGER] Request complete","traceId":"xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx","policyRoute":"direct_create_artifact","managerLlmBypassed":true,"managerCalls":0,"workerCalls":1,"totalModelCalls":1,...}
```

**验收要点**：
| 字段 | 期望值 | 说明 |
|------|--------|------|
| `policyRoute` | `direct_create_artifact` | 识别为新建 artifact |
| `managerCalls` | `0` | Manager bypass 生效 |
| `workerCalls` | `1` | Worker 执行 |
| `isRevisionTask` | `false` | 非 revision 任务 |
| `pricingKnown` | `true` | DeepSeek-V4-Flash 定价已知 |

---

### MSG2：改按钮蓝色（revision of MSG1）

**Harness 端输出**：
```
[MSG2] 把按钮改成蓝色。
--------------------------------------------------
  Reply   : ...<button style={{ backgroundColor: '#2196F3' ...
  TotalMs : xxxxms
  ArtifactId/TaskId: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ┌─ Ledger ─────────────────────────────────────────────
  │  managerCalls=0  workerCalls=1  totalModelCalls=1
  │  Entries:
  │    [worker] deepseek-ai/DeepSeek-V4-Flash  in=xxx out=xxx ms=xxx  cost=$0.00xxxx  known=true(configured)
  │  Security Scope:
  │    artifactToManager = false
  │    artifactToWorker = true
  │    artifactBytesWorker = xxx
  │    rawHistoryToWorker = false
  │    rawMemoryToWorker = false
  │    sensitiveMemSent = false
  └─────────────────────────────────────────────────────
  Lineage : revisionOf = artifact_of_MSG1
```

**服务器日志**：
```
{"msg":"[CALL_LEDGER_WORKER] Worker model call complete",...,"isRevisionTask":true,...}
{"msg":"[CALL_LEDGER] Request complete","policyRoute":"direct_artifact_revision","managerCalls":0,"workerCalls":1,"securityScope":{"sentArtifactContentToManagerRemote":false,"sentArtifactContentToWorkerRemote":true,"sentRawHistoryToWorkerRemote":false,"sentRawMemoryToWorkerRemote":false,"sensitiveMemoryWasSent":false,...},...}
```

**验收要点**：
| 字段 | 期望值 | 说明 |
|------|--------|------|
| `policyRoute` | `direct_artifact_revision` | 识别为 revision |
| `managerCalls` | `0` | Manager bypass |
| `workerCalls` | `1` | Worker 执行 |
| `isRevisionTask` | `true` | 确认 revision 标记 |
| `sentArtifactContentToManagerRemote` | `false` | **安全：artifact 不发给 Manager** |
| `sentArtifactContentToWorkerRemote` | `true` | artifact 发给 Worker |
| `sentRawHistoryToWorkerRemote` | `false` | **安全：不带 raw history** |
| `sentRawMemoryToWorkerRemote` | `false` | **安全：不带 memory** |
| `sensitiveMemoryWasSent` | `false` | **安全：敏感内存不泄露** |

---

### MSG3：改标题大一点（revision of MSG2）

**Harness 端输出**：
```
[MSG3] 再把标题改大一点。
--------------------------------------------------
  Reply   : ...<h1 style={{ fontSize: '32px' }}...
  TotalMs : xxxxms
  ArtifactId/TaskId: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ┌─ Ledger ─────────────────────────────────────────────
  │  managerCalls=0  workerCalls=1  totalModelCalls=1
  │  Entries:
  │    [worker] deepseek-ai/DeepSeek-V4-Flash  ...
  │  Security Scope:
  │    artifactToWorker = true
  │    artifactBytesWorker = xxx
  │    rawHistoryToWorker = false
  └─────────────────────────────────────────────────────
  Lineage : revisionOf = artifact_of_MSG2
```

**验收要点**：
| 字段 | 期望值 | 说明 |
|------|--------|------|
| `policyRoute` | `direct_artifact_revision` | 连续 revision |
| `managerCalls` | `0` | 连续 bypass |
| `revisionOfArtifactId` | `artifact_of_MSG2` | Lineage 链完整 |
| Security scope | 同 MSG2 | 安全不变量保持 |

---

### MSG4：再写一个注册页（create，activeArtifact 存在）

**Harness 端输出**：
```
[MSG4] 再帮我写一个注册页。
--------------------------------------------------
  Reply   : ```jsx\nimport React, { useState } from 'react';\n...
  TotalMs : xxxxms
  ArtifactId/TaskId: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  ┌─ Ledger ─────────────────────────────────────────────
  │  managerCalls=0  workerCalls=1  totalModelCalls=1
  │  Entries:
  │    [worker] deepseek-ai/DeepSeek-V4-Flash  ...
  │  Security Scope:
  │    artifactToWorker = false
  └─────────────────────────────────────────────────────
  Lineage : (new artifact)
```

**验收要点**：
| 字段 | 期望值 | 说明 |
|------|--------|------|
| `policyRoute` | `direct_create_artifact` | 识别为新建（不是修改） |
| `managerCalls` | `0` | Manager bypass |
| `revisionOfArtifactId` | `null` / `undefined` | 确认不是 revision |
| Security scope | `artifactToWorker = false` | 新建场景无 artifact 源 |

---

## 验证清单

### Ledger 聚合验证

```powershell
# 在服务器日志中 grep 同 traceId 的 Request + Worker 日志
# 格式：同一条 traceId 既有 [CALL_LEDGER] 也有 [CALL_LEDGER_WORKER]

grep "traceId" server.log | grep "721aa0e3-c692-4531-adb2-0242095cd792"
# 期望：至少 2 行（1 个 Request complete + 1 个 Worker complete）
```

### Security Scope 验证

```powershell
# 验证 revision 场景安全不变量
grep "CALL_LEDGER" server.log | grep -E "(MSG2|MSG3)" | jq '.securityScope'

# 期望（对每条 revision）：
# {
#   "sentArtifactContentToManagerRemote": false,   ← Manager 收不到 artifact 原文
#   "sentArtifactContentToWorkerRemote": true,    ← Worker 收到 artifact 原文
#   "sentRawHistoryToWorkerRemote": false,         ← Worker 不带 history
#   "sentRawMemoryToWorkerRemote": false,          ← Worker 不带 memory
#   "sensitiveMemoryWasSent": false                ← 敏感内存不泄露
# }
```

### Pricing 验证

```powershell
# 验证 pricingKnown = true，estCost 非 0 非 null
grep "CALL_LEDGER" server.log | jq '.entries[] | select(.modelRole=="worker") | {model, pricingKnown, estimatedCost}'

# 期望：
# {
#   "model": "deepseek-ai/DeepSeek-V4-Flash",
#   "pricingKnown": true,
#   "estimatedCost": 0.003483    ← 真实数字，不是 0，不是 null
# }
```

---

## Harness 结束摘要解读

正常结束时，harness 输出：

```
======================================================================
E2E Summary
======================================================================
Session ID: e2e-1747300000000

Artifact Lineage Chain:
  MSG1: artifact=xxxxxxxx  revisionOf=(new artifact)
  MSG2: artifact=yyyyyyyy  revisionOf=xxxxxxxx
  MSG3: artifact=zzzzzzzz  revisionOf=yyyyyyyy
  MSG4: artifact=wwwwwwww  revisionOf=(new artifact)

Ledger Summary Table:
  MSG1  managerCalls=0    workerCalls=1   totalCalls=1   estCost=$0.00xxxx  known=true  configured
  MSG2  managerCalls=0    workerCalls=1   totalCalls=1   estCost=$0.00xxxx  known=true  configured
  MSG3  managerCalls=0    workerCalls=1   totalCalls=1   estCost=$0.00xxxx  known=true  configured
  MSG4  managerCalls=0    workerCalls=1   totalCalls=1   estCost=$0.00xxxx  known=true  configured

Verification checklist (check server logs for [CALL_LEDGER]):

  MSG1: policyRoute=direct_create_artifact OR manager_llm_required→delegate
        workerCalls=1, artifact_A generated
  MSG2: policyRoute=direct_artifact_revision
        managerCalls=0, workerCalls=1, revisionOf=artifact_A
  MSG3: policyRoute=direct_artifact_revision
        managerCalls=0, workerCalls=1, revisionOf=artifact_B
  MSG4: policyRoute=direct_create_artifact
        managerCalls=0, workerCalls=1, revisionOfArtifactId=undefined

  Security (for MSG2, MSG3):
        sentArtifactContentToWorkerRemote=true
        sentArtifactContentToManagerRemote=false
        sentRawHistoryToWorkerRemote=false

  Pricing:
        pricingKnown=true (DeepSeek-V4-Flash now in pricing.ts)
        estCost should be a real number, NOT null or 0
======================================================================
```

---

## 收口标准

| # | 验收项 | 通过条件 |
|---|--------|----------|
| 1 | Request 侧 ledger 嵌入 SSE done | harness 打印出 managerCalls/workerCalls/entries（非 `?`） |
| 2 | Worker ledger 同 traceId 可关联 | 服务器日志有同 traceId 的 [CALL_LEDGER] + [CALL_LEDGER_WORKER] |
| 3 | MSG2/3 revision routing 正确 | policyRoute = `direct_artifact_revision`，managerCalls = 0 |
| 4 | MSG2/3 security scope 正确 | artifact→Worker=true，artifact→Manager=false，history=false |
| 5 | MSG4 create 识别正确 | policyRoute = `direct_create_artifact`，revisionOf = null |
| 6 | Lineage 链完整 | artifact_A → B → C 链可追溯 |
| 7 | Pricing 生效 | pricingKnown = true，estCost 为真实数字 |

**全部通过 → Sprint 60P-H2 正式收口 ✅**

---

## 常见问题

### Q: harness 打印 `(not in SSE)`？

**原因**：服务器未更新到 commit `2e2e248`（ledger 未嵌入 done 事件）
**解决**：
```powershell
cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS
git pull
# 重启服务器
```

### Q: 所有 workerCalls 都是 0？

**原因**：模型配置问题或 API 超时
**解决**：检查 `src/config/pricing.ts` 是否包含 `deepseek-ai/DeepSeek-V4-Flash`；检查 `.env` 的 API key

### Q: revision 场景走了 Manager 路径？

**原因**：`activeArtifact` 未正确识别
**解决**：检查 `extractActiveArtifactContext` 是否正常工作；确认 history 中有 assistant artifact

### Q: Security scope 字段全 false？

**原因**：`buildSecurityScope` 未正确计算 revision 场景
**解决**：检查 `src/router/execution-policy.ts` 中 revision 分支的 security scope 构建逻辑

---

## 网络恢复后同步

GFW 阻断时手动 push：

```powershell
cd C:\Users\ligua\Desktop\AI项目\trustos\TrustOS
git push origin master
# 或网络恢复后自动同步
```

---

_横行天下，一钳定乾坤。_ 🦀
