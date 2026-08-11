# TrustOS Private Beta — Reviewer Feedback Form

```text
Version: v0.1
Date: 2026-08-03
Purpose: Structured feedback from each Private Beta reviewer
```

---

## Reviewer Info

| Field | Value |
|---|---|
| Reviewer ID (anonymous label) | |
| Reviewer Profile | AI Product / Governance / Security / Developer / Skeptical |
| Session Date | |
| Session Duration | |

---

## Part 1 — Comprehension (Product Loop)

### Q1. 你能否用自己的话描述 TrustOS 的核心产品闭环？

> (提示: Observe → Assess → Control → Evidence → Verify)

### Q2. 你在哪个环节感到最清晰？哪个环节最不清晰？

---

## Part 2 — Setup Experience

### Q3. Setup 体验评分 (1–5)

> 1 = 完全无法完成，5 = 非常顺利

| Score | |
|---|---|

### Q4. Setup 过程中最困难的是什么？

---

## Part 3 — Observe (观测)

### Q5. 你是否理解 trace_id 的作用？

- [ ] 理解，可以用来关联同一次推理的事件
- [ ] 大致理解
- [ ] 不理解

### Q6. 事件字段 (event_hash / input_hash / output_hash) 对你来说是否清晰？

- [ ] 清晰
- [ ] 部分清晰
- [ ] 不清晰

### Q7. Observe 环节评分 (1–5)

> 1 = 完全不知道发生了什么，5 = 非常清晰

| Score | |
|---|---|

---

## Part 4 — Assess (风险评估)

### Q8. 你是否理解 low / medium / high 风险级别的含义？

- [ ] 是，理解
- [ ] 大致理解但需要更多说明
- [ ] 不理解

### Q9. 风险评估信号是否让你觉得有用？

- [ ] 非常有用
- [ ] 有一定用处
- [ ] 用处不大
- [ ] 没用

### Q10. 你是否需要更详细的风险解释？

- [ ] 目前足够
- [ ] 需要更多分类细节
- [ ] 需要知道为什么触发每个信号

---

## Part 5 — Dry-Run Control

### Q11. 你是否清楚理解 TrustOS 当前不实际拦截请求？

- [ ] 清楚，理解 dry-run = 只建议不执行
- [ ] 不确定
- [ ] 我以为它会拦截

### Q12. 干系模式评分的清晰度 (1–5)

> 1 = dry-run 概念完全不清晰，5 = 完全理解

| Score | |
|---|---|

### Q13. 你希望在什么场景下看到真实拦截？

---

## Part 6 — Evidence (证据)

### Q14. 证据包的内容是否让你放心？

- [ ] 放心（只有哈希，不含原始内容，隐私安全）
- [ ] 希望看到原始内容
- [ ] 不确定

### Q15. 哈希复核模式是否可接受？

- [ ] 可接受 — 我有独立渠道获取原始输出来做验证
- [ ] 需要更强的证据形式（如签名）
- [ ] 不确定

### Q16. 证据有用性评分 (1–5)

> 1 = 毫无用处，5 = 非常有用

| Score | |
|---|---|

### Q17. 证据包缺少什么？（如果有）

---

## Part 7 — Correlate (关联)

### Q18. 多事件 trace demo 是否帮助你理解事件关联？

- [ ] 是，trace_id 关联多个事件很有用
- [ ] 部分有帮助
- [ ] 没有帮助

### Q19. 你是否能想象多事件 trace 在实际 governance review 中的作用？

- [ ] 是
- [ ] 可以想象但不确定
- [ ] 不能

---

## Part 8 — Overall Trust

### Q20. 整体信任评分 (1–5)

> 1 = 完全不信任 TrustOS，5 = 完全信任

| Score | |
|---|---|

### Q21. 整体理解评分 (1–5)

> 1 = 完全不理解 TrustOS 做什么，5 = 完全理解

| Score | |
|---|---|

### Q22. 你认为 TrustOS 解决的是什么问题？（可多选）

- [ ] AI 输出可追溯性
- [ ] AI 安全使用治理
- [ ] AI 调用审查记录 / governance review record
- [ ] 其他: _______

### Q23. 你是否愿意再次使用 TrustOS？

- [ ] 愿意
- [ ] 愿意但有保留
- [ ] 不愿意

---

## Part 9 — Perceived Gaps

### Q24. 你最希望看到的下一步能力（可多选，最多 3 项）

- [ ] 真实的请求拦截 (enforcement)
- [ ] 经过认证的用户/agent 身份
- [ ] 下载证据文件
- [ ] 支持流式请求 (streaming)
- [ ] 多模型路由
- [ ] 团队/多用户协作
- [ ] API 评估端点
- [ ] 更详细的 risk explanation
- [ ] 历史事件搜索/筛选
- [ ] 其他: _______

### Q25. 目前最大的 blocker 是什么？（如果有的话你会因此拒绝使用 TrustOS）

---

## Part 10 — Most Valuable

### Q26. 你觉得 TrustOS 最有价值的功能是什么？

---

## Part 11 — Suggested Next Phase

### Q27. 如果你是 TrustOS 的 PM，下一步你会优先做什么？

---

## Part 12 — Open Feedback

### Q28. 还有什么想说的？（困惑、建议、吐槽都欢迎）

---

## Scoring Summary

| Dimension | Score (1–5) |
|---|---|
| Setup | |
| Observe | |
| Dry-Run Clarity | |
| Evidence Usefulness | |
| Overall Trust | |
| Overall Comprehension | |
| **Average** | |

---

> **Status**: Feedback Form — Ready (2026-08-03)  
> **Note**: 反馈将用于 Round 1 closure 决策和 TRST-4 chartering。所有 reviewer 身份匿名。
