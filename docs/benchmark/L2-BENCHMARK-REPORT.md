# Sprint 57 Report: L2 在线 Benchmark — LLM vs 离线规则

**日期**: 2026-04-25
**执行**: `benchmark-routing.cjs --mode layer2 --provider siliconflow`
**模型**: Qwen/Qwen2.5-7B-Instruct @ SiliconFlow
**测试用例**: 30 条 L2 benchmark cases（benchmark-layer2.json）

---

## 核心结论

> **离线规则基线（63.3%）> LLM 路由（40.0%）**

Qwen2.5-7B-Instruct 在 L2 路由任务上表现不如离线规则，原因：
1. 模型太小，无法可靠理解"何时应该委托 slow"的复杂决策
2. 部分输出无法解析为标准 action（`unknown` 占 6/30）
3. 模型倾向于认为"自己知道答案"，把需要深度分析的任务判为 `fast`

---

## 详细结果

### 整体准确率

| 指标 | LLM (Qwen2.5-7B) | 离线规则 | 差距 |
|------|-----------------|---------|------|
| Mode 准确率 | **40.0%** (12/30) | **63.3%** (19/30) | -23.3pp |
| Intent 准确率 | 0% | 0% | — |
| 平均延迟 | 12,207ms | <1ms | — |

### 按场景

| 场景 | LLM | 规则 | 说明 |
|------|-----|------|------|
| L2-deep-summary | **66.7%** | 83.3% | 摘要类规则强（"阅读报告"等词触发） |
| L2-multi-hop | 37.5% | 50.0% | 对比/分析类，规则模式匹配有效 |
| L2-tool-chain | 37.5% | 62.5% | 搜索→处理链，规则"调研"等词精准 |
| L2-edge | 25.0% | 50.0% | 边缘 case，LLM 和规则都困难 |
| L2-cross-session | 25.0% | 75.0% | 规则依赖"继续/接着"，LLM 无此能力 |

### 失败案例分析

#### LLM 失败（12条，判 fast 但应该 slow）
- "对比分析一下 Transformer 和 RNN..." → `fast`（模型觉得自己能答）
- "腾讯云和阿里云核心差异" → `unknown`（输出无法解析）
- "人民币贬值影响" → `unknown`（无法解析）
- "搜索向量数据库对比" → `unknown`（无法解析）

#### 规则失败（11条）
- "解释大语言模型幻觉" → `fast`（无"分析/对比"等触发词）
- "搜索2024年Q4中国手机市场" → `fast`（无"调研/研究"词）
- "整理会议记录摘要" → `fast`（"摘要"在规则里被 deep-summary 捕获，但这个用例判 slow）
- "计算Python/JavaScript差异" → `fast`（代码模式匹配"实现"等词才能触发 slow）

---

## 根因分析

### 为什么 LLM 输给规则？

**1. 模型能力限制（Qwen2.5-7B）**
- 7B 参数不足以可靠执行复杂推理指令
- 倾向于"自信但错误"——觉得自己能直接回答复杂问题
- Prompt 太长导致输出格式不稳定

**2. Prompt 问题（诊断发现）**
- 原始 manager prompt 包含可选字段（`direct_response`/`clarification`/`command`）
- 模型不知道何时填哪个，导致输出 JSON 混乱
- **修复后**：简化 schema → JSON 解析成功率 100%

**3. 规则的优势**
- 规则是"专门为 L2 测试集调优的"——这是偏差，不是规则真的更强
- 规则在已知 pattern 上表现好，但在泛化场景差
- LLM 理论上应该泛化能力更强，但受模型大小限制

### Intent 准确率 0% 的问题

benchmark-layer2.json 中 `expected_intent` 字段（如 `reasoning`/`summarization`/`research`）没有被映射到输出 schema。当前只评估 `fast/slow`（mode），不评估具体 intent 级别。这在本次 scope 内可接受（主要对比 L1/L2 路由能力）。

---

## 下一步建议

### 短期（高 ROI）
1. **用 Qwen2.5-72B-Instruct 重新跑 benchmark**
   - 72B 的推理能力应该显著超过规则
   - 预计可达 80-90% Mode 准确率
   - 这是验证"LLM 路由"方案是否成立的关键实验

2. **增加 unknown 兜底规则**
   - 当 LLM 返回 `unknown` 时，降级到规则判断
   - Hybrid 路由：LLM 优先 + 规则兜底

### 中期（架构优化）
3. **分离 Mode 判断和 Intent 分类**
   - 当前 LLM 一次输出两个维度（mode + intent）
   - 解耦后可以单独优化每个维度
   - Intent 评估需要 label 数据积累

4. **Benchmark CI 接入 LLM 路由**
   - 当前 CI 只跑离线规则
   - 接入 SiliconFlow LLM 路由后，可作为 CI gate（72B 模型）
   - 失败 case 自动追加到 regression set

---

## 关键文件

- `benchmark-routing.cjs` — 主脚本（支持 siliconflow/ollama/offline）
- `evaluation/tasks/benchmark-layer2.json` — 30 条 L2 测试用例
- `scripts/benchmark-ci.cjs` — CI 规则路由套件
- `results/layer2-benchmark-siliconflow-2026-04-25.json` — 完整结果

---

## 附录：诊断发现

### 问题：模型原始输出 JSON 乱码
- **根因**：原始 manager prompt 包含可选 JSON 字段（`direct_response`/`clarification`/`command`），模型不知道何时填哪个，输出格式混乱
- **诊断**：分别测试 minimal_en / full_en / full_zh 三种 prompt
- **结论**：full_en/full_zh 简洁 prompt（固定必须字段）→ JSON 解析 100% 成功
- **修复**：benchmark-routing.cjs 已更新为简化版 prompt
