/**
 * Sprint 57 诊断：测试 SiliconFlow 模型输出质量
 * 目标：找一条能正常输出的 prompt + 参数组合
 */
const fs = require("fs");
const path = require("path");

// 加载 .env
try {
  const envContent = fs.readFileSync(path.join(__dirname, ".env"), "utf8");
  envContent.split("\n").forEach((line) => {
    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) return;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    if (key && !key.startsWith("#") && !process.env[key]) process.env[key] = val;
  });
} catch (_) {}

const apiKey = process.env.SILICONFLOW_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = process.env.SILICONFLOW_BASE_URL || "https://api.siliconflow.cn/v1";
const model = process.env.FAST_MODEL || "Qwen/Qwen2.5-7B-Instruct";

console.log(`API: ${baseUrl}`);
console.log(`Model: ${model}\n`);

const TEST_CASES = [
  {
    label: "Case-01: 简单 fast",
    input: "你好，今天天气怎么样？",
    expected: "fast",
    expected_intent: "greeting",
  },
  {
    label: "Case-07: 深度分析 slow",
    input: "帮我分析一下 Transformer 和 RNN 的核心区别",
    expected: "slow",
    expected_intent: "comparison",
  },
  {
    label: "Case-20: 工具链 slow",
    input: "调研一下最近量子计算领域的最新进展",
    expected: "slow",
    expected_intent: "research",
  },
];

// 精简版 prompt（英文 + 简化 schema）
const PROMPTS = {
  minimal_en: `You are a router. Respond with ONLY valid JSON:
{"decision":"fast"|"slow","reason":"1 word"}`,

  full_en: `You are SmartRouter Pro's Manager.

Given a user message, decide whether to route to Fast model (direct_answer, ask_clarification) or Slow model (delegate_to_slow, execute_task).

Respond with ONLY valid JSON (no extra text):
{
  "decision": "fast" or "slow",
  "primary_action": "direct_answer|ask_clarification|delegate_to_slow|execute_task",
  "scores": {
    "direct_answer": 0.0-1.0,
    "delegate_to_slow": 0.0-1.0,
    "execute_task": 0.0-1.0
  },
  "reasoning": "1 sentence"
}`,

  full_zh: `你是SmartRouter Pro的Manager。

根据用户消息决定路由：
- fast模型：直接回复、闲聊
- slow模型：深度分析、多步推理、搜索研究

只输出JSON，禁止其他文字：
{"decision":"fast"|"slow","primary_action":"...","reasoning":"..."}`,
};

async function testCall(prompt, userMsg, label) {
  console.log(`\n=== ${label} ===`);
  console.log(`Prompt length: ${prompt.length} chars`);
  console.log(`User: ${userMsg}`);

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userMsg },
        ],
        temperature: 0.3,
        max_tokens: 400,
      }),
    });

    if (!res.ok) {
      console.log(`  HTTP ERROR: ${res.status}`);
      return;
    }

    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || "";
    console.log(`  Raw (300 chars): ${JSON.stringify(content.substring(0, 300))}`);

    // 尝试解析
    const m1 = content.match(/```json\s*([\s\S]*?)\s*```/)?.[1];
    const m2 = content.match(/```\s*([\s\S]*?)\s*```/)?.[1];
    const m3 = content.match(/(\{[\s\S]*\})/)?.[1];
    const tryParse = (s) => { try { return JSON.parse(s?.trim()); } catch { return null; } };

    const parsed = tryParse(m1) || tryParse(m2) || tryParse(m3);
    if (parsed) {
      console.log(`  ✅ Parsed: ${JSON.stringify(parsed)}`);
    } else {
      console.log(`  ❌ Parse failed`);
    }
  } catch (e) {
    console.log(`  Exception: ${e.message}`);
  }
}

async function main() {
  // 先测 minimal_en（最短 prompt，最容易成功）
  console.log("=== TEST 1: minimal_en prompt ===");
  await testCall(PROMPTS.minimal_en, "今天天气怎么样？", "minimal_en");

  console.log("\n=== TEST 2: full_en prompt ===");
  await testCall(PROMPTS.full_en, "Transformer vs RNN 核心区别", "full_en");

  console.log("\n=== TEST 3: full_zh prompt ===");
  await testCall(PROMPTS.full_zh, "分析一下 Transformer 和 RNN 的核心区别", "full_zh");
}

main().catch(console.error);
