// tests/services/split-manager-output.test.ts
// 测试 splitManagerOutput() 的边界情况
// splitManagerOutput 未导出，通过动态 import + monkey-patching 访问
// 改为直接内联复制函数逻辑进行测试（白盒）

// ── 内联被测函数（与 llm-native-router.ts 保持同步）──────────────────────────
function splitManagerOutput(output: string): { userFacingText: string; jsonPart: string } {
  // 匹配 ```json 块
  const jsonMatch = output.match(/```json\s*([\s\S]*?)\s*```/);

  if (jsonMatch) {
    const jsonPart = jsonMatch[1];
    const userFacingText = output.slice(0, jsonMatch.index).trim();
    return { userFacingText, jsonPart };
  }

  // 如果没有找到 JSON 块，尝试匹配裸 JSON
  const bareJsonMatch = output.match(/(\{[\s\S]*\})/);
  if (bareJsonMatch) {
    const jsonPart = bareJsonMatch[1];
    const userFacingText = output.slice(0, bareJsonMatch.index).trim();
    return { userFacingText, jsonPart };
  }

  // 如果没有 JSON，整个文本都视为用户可见文本
  return { userFacingText: output.trim(), jsonPart: "" };
}

// ── 测试 ──────────────────────────────────────────────────────────────────────

describe("splitManagerOutput", () => {
  // ── 正常路径 ────────────────────────────────────────────────────────────────

  it("正常双重输出：自然语言 + ```json 块", () => {
    const input = `好的，我来帮你分析这个问题。

\`\`\`json
{"schema_version":"manager_decision_v3","decision_type":"direct_answer"}
\`\`\``;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("好的，我来帮你分析这个问题。");
    expect(jsonPart).toContain("manager_decision_v3");
    expect(() => JSON.parse(jsonPart)).not.toThrow();
  });

  it("只有 JSON 块，没有前置自然语言", () => {
    const input = `\`\`\`json
{"schema_version":"manager_decision_v3","decision_type":"delegate_to_slow"}
\`\`\``;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("");
    expect(jsonPart).toContain("delegate_to_slow");
  });

  it("只有自然语言，没有 JSON", () => {
    const input = "好的，让我帮你看一下这个问题。";
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("好的，让我帮你看一下这个问题。");
    expect(jsonPart).toBe("");
  });

  it("空字符串输入", () => {
    const { userFacingText, jsonPart } = splitManagerOutput("");
    expect(userFacingText).toBe("");
    expect(jsonPart).toBe("");
  });

  // ── 边界情况 ─────────────────────────────────────────────────────────────────

  it("自然语言中含中文大括号，不误识别为 JSON", () => {
    // 中文大括号 ｛｝ 是全角字符，不会被正则匹配
    const input = "用户说了｛这个需求｝，我需要分析一下。";
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("用户说了｛这个需求｝，我需要分析一下。");
    expect(jsonPart).toBe("");
  });

  it("自然语言中含半角大括号（如代码示例），会被误识别为裸 JSON —— 记录预期行为", () => {
    // 这是已知限制：自然语言里的 {key: value} 会被识别为裸 JSON
    // 正确处理方式是用 ```json 块，而不是裸 JSON
    const input = `可以用如下格式：{key: "value"}`;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    // 裸 JSON 检测会误匹配，jsonPart 非空
    // 此测试记录现有行为，不是 bug（避免回归时意外）
    expect(jsonPart).not.toBe("");
    // userFacingText 是大括号前的文本
    expect(userFacingText).toBe("可以用如下格式：");
  });

  it("JSON 块前有多行自然语言", () => {
    const input = `首先分析需求。

其次评估复杂度。

最终决策如下：

\`\`\`json
{"schema_version":"manager_decision_v3","scores":{"direct_answer":0.9}}
\`\`\``;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toContain("首先分析需求");
    expect(userFacingText).toContain("最终决策如下");
    expect(jsonPart).toContain("direct_answer");
  });

  it("JSON 块中有换行和缩进（pretty print）", () => {
    const input = `好的。\n\n\`\`\`json\n{\n  "schema_version": "manager_decision_v3",\n  "decision_type": "direct_answer"\n}\n\`\`\``;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("好的。");
    const parsed = JSON.parse(jsonPart);
    expect(parsed.schema_version).toBe("manager_decision_v3");
  });

  it("多个 ```json 块只取第一个", () => {
    const input = `第一段\n\n\`\`\`json\n{"block":1}\n\`\`\`\n\n第二段\n\n\`\`\`json\n{"block":2}\n\`\`\``;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    // 只取第一个 JSON 块
    const parsed = JSON.parse(jsonPart);
    expect(parsed.block).toBe(1);
    expect(userFacingText).toBe("第一段");
  });

  it("JSON 块内容是非法 JSON —— splitManagerOutput 不抛错，调用方处理解析失败", () => {
    const input = "好的。\n\n```json\n{invalid json here\n```";
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    // splitManagerOutput 不解析 JSON，只切割字符串
    expect(userFacingText).toBe("好的。");
    expect(jsonPart).toBe("{invalid json here");
    // 调用方解析时会抛错，这是预期行为
    expect(() => JSON.parse(jsonPart)).toThrow();
  });

  it("输入前后有大量空白字符", () => {
    const input = "   \n\n  好的。\n\n   ";
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("好的。");
    expect(jsonPart).toBe("");
  });

  // ── 生产场景模拟 ──────────────────────────────────────────────────────────────

  it("完整生产输出：包含置信度分数和委派指令", () => {
    const input = `这道题挺复杂，需要深度分析，我让专业模型来帮你处理。

\`\`\`json
{
  "schema_version": "manager_decision_v3",
  "scores": {
    "direct_answer": 0.1,
    "ask_clarification": 0.05,
    "delegate_to_slow": 0.85,
    "execute_task": 0.3
  },
  "confidence_hint": 0.88,
  "features": {
    "needs_long_reasoning": true,
    "needs_external_tool": false,
    "missing_info": false,
    "high_risk_action": false,
    "query_too_vague": false,
    "requires_multi_step": true,
    "is_continuation": false
  },
  "rationale": "用户问题需要深度分析",
  "decision_type": "delegate_to_slow",
  "command": { "task_brief": "分析用户请求", "constraints": [] }
}
\`\`\``;
    const { userFacingText, jsonPart } = splitManagerOutput(input);
    expect(userFacingText).toBe("这道题挺复杂，需要深度分析，我让专业模型来帮你处理。");
    const parsed = JSON.parse(jsonPart);
    expect(parsed.decision_type).toBe("delegate_to_slow");
    expect(parsed.scores.delegate_to_slow).toBe(0.85);
  });
});
