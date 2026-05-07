# repositories.ts 拆分方案

## 现状
- 文件：`src/db/repositories.ts`
- 总行数：**2076 行**
- Repository 数量：**16 个**
- 问题：单文件过大、循环依赖风险、难以维护

## 拆分目标
1. 按领域（Domain）拆分为多个文件
2. 消除循环依赖
3. 保持 API 兼容性（通过 index 文件重新导出）
4. 每一步可独立测试

---

## 文件结构（拆分后）

```
src/db/
├── repositories/
│   ├── index.ts                      # 重新导出所有 repo，保持向后兼容
│   ├── decision-feedback.ts          # DecisionRepo + FeedbackEventRepo
│   ├── task-archive.ts              # TaskRepo + TaskArchiveRepo + TaskWorkspaceRepo
│   ├── delegation.ts                # DelegationArchiveRepo + DelegationLogRepo
│   ├── execution.ts                 # ExecutionResultRepo + EvidenceRepo
│   ├── memory-growth.ts             # MemoryRepo + MemoryEntryRepo + GrowthRepo
│   └── system.ts                    # PromptTemplateRepo + SessionContextRepo + PermissionRequestRepo + ScopedTokenRepo
└── repositories.ts                  # 废弃，改为 re-export（过渡期）
```

---

## 详细拆分映射

### 1. `decision-feedback.ts` （~290 行）
| Repo | 原行号 |
|------|--------|
| DecisionRepo | 7-243 |
| FeedbackEventRepo | 244-293 |

**依赖**：无外部 repo 依赖（只依赖 `query` 和 `types`）

---

### 2. `task-archive.ts` （~690 行）
| Repo | 原行号 |
|------|--------|
| TaskRepo | 352-522 |
| TaskArchiveRepo | 1138-1284 |
| TaskWorkspaceRepo | 1954-2035 |

**依赖**：可能依赖 `DelegationArchiveRepo`（需确认）

---

### 3. `delegation.ts` （~800 行）
| Repo | 原行号 |
|------|--------|
| DelegationArchiveRepo | 876-1137 |
| DelegationLogRepo | 1384-1676 |

**依赖**：可能依赖 `TaskRepo`（需确认）

---

### 4. `execution.ts` （~330 行）
| Repo | 原行号 |
|------|--------|
| ExecutionResultRepo | 758-875 |
| EvidenceRepo | 1285-1383 |

**依赖**：无外部 repo 依赖

---

### 5. `memory-growth.ts` （~470 行）
| Repo | 原行号 |
|------|--------|
| MemoryRepo | 294-351 |
| GrowthRepo | 523-567 |
| MemoryEntryRepo | 568-757 |

**依赖**：`MemoryRepo` 可能依赖 `TaskRepo`（需确认）

---

### 6. `system.ts` （~570 行）
| Repo | 原行号 |
|------|--------|
| PromptTemplateRepo | 1677-1764 |
| SessionContextRepo | 1765-1855 |
| PermissionRequestRepo | 1856-1953 |
| ScopedTokenRepo | 2036-2076 |

**依赖**：无外部 repo 依赖

---

## 执行步骤

### Step 1: 创建目录结构
```bash
mkdir -p src/db/repositories
```

### Step 2: 逐个创建新文件（按依赖顺序）
按**依赖从少到多**的顺序创建，降低风险：

1. **system.ts** - 无外部依赖，最安全
2. **execution.ts** - 无外部依赖
3. **decision-feedback.ts** - 无外部依赖
4. **memory-growth.ts** - 需确认是否有依赖
5. **delegation.ts** - 可能有依赖
6. **task-archive.ts** - 可能有依赖

### Step 3: 创建 `repositories/index.ts`
统一重新导出所有 repo，保持 API 兼容性：
```typescript
export { DecisionRepo } from './decision-feedback.js';
export { FeedbackEventRepo } from './decision-feedback.js';
export { TaskRepo } from './task-archive.js';
// ... 其他导出
```

### Step 4: 更新引用
查找所有 `import { XXXRepo } from '../db/repositories.js'` 的地方，改为：
- 方式 A：直接引用新文件 `from '../db/repositories/decision-feedback.js'`
- 方式 B：继续引用 `from '../db/repositories.js'`（通过 index.ts 保持兼容）

**推荐方式 B**（渐进式迁移，降低风险）

### Step 5: 删除旧文件
确认所有引用已更新后，删除 `src/db/repositories.ts`

### Step 6: 测试
运行 `npm run test:repos` 确保 257/257 仍然全绿。

---

## 风险与注意事项

### 1. 循环依赖检查
在拆分前，必须先检查 repo 之间的相互调用：
```bash
# 查找 repo 之间的相互引用
grep -n "Repo\." src/db/repositories.ts
```

### 2. 类型依赖
确保所有 `types/index.ts` 中的类型定义被正确导入。

### 3. 导入路径
新文件使用相对导入：`import { query } from '../connection.js';`
注意：由于拆分成多个文件，导入路径可能需要调整（`../` vs `./`）

### 4. 向后兼容
保留 `src/db/repositories.ts` 作为 re-export 包装器，给其他模块缓冲时间更新导入路径。

---

## 推荐的导入路径策略

### 方案 A：直接导入（推荐，长期）
```typescript
// 其他文件直接引用具体文件
import { DecisionRepo } from '../db/repositories/decision-feedback.js';
```

**优点**：
- 清晰的依赖关系
- 更好的 tree-shaking
- 易于定位代码

**缺点**：
- 需要批量更新导入语句

---

### 方案 B：通过 index.ts（推荐，短期过渡）
```typescript
// 其他文件继续引用 index
import { DecisionRepo } from '../db/repositories/index.js';
```

**优点**：
- 最小化改动
- 渐进式迁移

**缺点**：
- 隐藏了实际依赖关系

---

## Claude Code 执行检查清单

- [ ] Step 1: 创建 `src/db/repositories/` 目录
- [ ] Step 2: 检查循环依赖（`grep -n "Repo\." src/db/repositories.ts`）
- [ ] Step 3: 创建 `system.ts`（无依赖，最安全）
- [ ] Step 4: 创建 `execution.ts`
- [ ] Step 5: 创建 `decision-feedback.ts`
- [ ] Step 6: 创建 `memory-growth.ts`（检查依赖）
- [ ] Step 7: 创建 `delegation.ts`（检查依赖）
- [ ] Step 8: 创建 `task-archive.ts`（检查依赖）
- [ ] Step 9: 创建 `repositories/index.ts`（重新导出）
- [ ] Step 10: 更新 `src/db/repositories.ts` 为 re-export
- [ ] Step 11: 运行测试 `npm run test:repos`
- [ ] Step 12: 如果测试全绿，批量更新其他文件的导入路径
- [ ] Step 13: 删除旧的 `src/db/repositories.ts`
- [ ] Step 14: 再次测试，确保全绿
- [ ] Step 15: Commit & Push

---

## 预计结果

| 指标 | 拆分前 | 拆分后 |
|------|--------|--------|
| 文件数 | 1 | 7 |
| 最大文件行数 | 2076 | ~800 |
| 循环依赖风险 | 高 | 低 |
| 可维护性 | 低 | 高 |

---

**生成时间**：2026-05-07  
**执行者**：Claude Code  
**监督者**：蟹小钳 🦀
