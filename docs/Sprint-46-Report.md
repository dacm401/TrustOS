# Sprint 46 — Archive UI 可视化

**完成日期**: 2026-04-20
**状态**: ✅ COMPLETE

---

## 目标

为 Phase 5 Task Archive 提供前端可视化界面，让用户可以：
- 查看当前 Session 下的所有任务档案
- 按状态筛选（等待中/执行中/已完成/失败）
- 展开查看观察记录和执行结果
- 管理档案（删除已完成条目，修改状态）

---

## 交付内容

### 前端源码（`frontend/`）

| 文件 | 说明 |
|------|------|
| `src/lib/archive-api.ts` | Archive CRUD API 封装（fetchArchivesBySession / fetchArchiveById / deleteArchive / updateArchiveStatus） |
| `src/components/views/ArchiveView.tsx` | 主视图：状态筛选 + 档案卡片列表 + 展开详情 |
| `src/components/views/ArchiveCard.tsx` | （内嵌在 ArchiveView 中）档案卡片：任务/动作/状态/约束/观察/执行结果 |
| `src/components/layout/Sidebar.tsx` | 侧边栏新增 📦 Archive 导航项 |
| `src/app/page.tsx` | 主页面新增 `archive` NavView，sessionId 状态提升 |
| `src/components/chat/ChatInterface.tsx` | sessionId 通过 props 暴露给父级 |

### 新增 API 端点调用

```
GET  /v1/archive/tasks?session_id=xxx&limit=50  → 列表
GET  /v1/archive/tasks/:id                       → 详情
PATCH /v1/archive/tasks/:id/status               → 改状态
DELETE /v1/archive/tasks/:id                     → 删除
```

---

## 功能明细

### Archive 页面

- **状态筛选栏**: 全部 / 等待中 / 执行中 / 已完成 / 失败（显示数量 badge）
- **档案卡片**: 每个任务一条，显示：
  - 任务摘要（截断至 80 字符）
  - 状态 badge（颜色区分）
  - 动作 badge（web_search/execute/code/reasoning/clarify）
  - 用户输入预览
  - 相对时间（刚刚/分钟前/小时前/天前）
- **展开详情**: 点击卡片展开，显示：
  - 📡 观察记录列表（带时间戳）
  - ⚙️ 执行结果（状态/输出/错误/偏差）
  - 🔒 约束条件标签
  - 元数据（Session ID / Turn / 创建时间）
- **操作按钮**:
  - pending → 标记执行中
  - running → 标记完成
  - done/failed/cancelled → 删除
- **空状态**: 无 Session / 无档案 / 加载中 / 错误重试

### Session 打通

- `ChatInterface` 生成 `sessionId`，通过 `onSessionIdChange` 回调通知父级
- `app/page.tsx` 持有 `sessionId` 状态，同时传给 `ChatInterface` 和 `ArchiveView`
- Archive 加载该 Session 下的所有档案

---

## 技术说明

### 架构
- 复用现有 Sidebar 导航（不新建页面路由）
- Archive 作为 SPA 内嵌视图，与 Chat/Tasks/Memory/Dashboard 并列
- Session 共用机制：Chat 和 Archive 共享同一个 sessionId

### UI 风格
- 与 MemoryView/TasksView 一致的暗色主题 CSS 变量风格
- 状态颜色语义：pending=灰 / running=蓝 / done=绿 / failed=红 / cancelled=黄
- 动作图标映射：web_search=🔍 / execute=⚡ / code=💻 / reasoning=🧠 / clarify=❓

### 构建结果
```
✓ Compiled successfully
✓ Generating static pages (5/5)
Route (app)  Size     First Load JS
/           25 kB    112 kB
/dashboard   115 kB   202 kB
```

---

## Sprint 47 建议

| 方向 | 内容 |
|------|------|
| **A. 前端增强** | Archive 跨 Session 搜索、历史 Session 列表 |
| **B. Backend E2E** | Archive API 集成到实际 chat 流程（任务完成后自动落库）|
| **C. Intent CI 达标** | 换模型（14B+）解决 Intent accuracy 不达标问题 |
