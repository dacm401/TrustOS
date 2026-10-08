/**
 * TRST-6.3: 影子对照（Shadow Comparison）脚本
 *
 * 给定同一个 brief，分别用 cloud（默认 SiliconFlow）与 local（Ollama/本地 OpenAI 兼容端点）
 * 跑一次，输出三维度对照报告：延迟 / 质量（人工复核提示，不做自动打分）/ 成本估算。
 *
 * 设计边界（护栏）：
 *   - 零新依赖：复用既有 `openai` SDK + 环境变量，不改后端代码、不引新推理框架。
 *   - 不碰信任内核 / 网关 / enforcement。
 *   - "quality" 维度诚实标注为人工复核项，不给虚假自动评分。
 *   - local 不可达时明确标注 unavailable，不静默失败、不谎报。
 *
 * 运行：
 *   npx tsx scripts/trst6/run-shadow-compare.mts [--brief "你的任务描述"] [--cloud] [--local]
 * 环境变量（可选覆盖）：
 *   OPENAI_BASE_URL / OPENAI_API_KEY / FAST_MODEL
 *   LOCAL_LLM_BASE_URL / LOCAL_LLM_API_KEY / LOCAL_LLM_MODEL
 */

import OpenAI from "openai";

interface RunResult {
  label: string;
  endpoint: string;
  model: string;
  reachable: boolean;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  content: string | null;
  error?: string;
}

// 已知价格表（USD / 1k tokens），用于成本估算；未知模型标 "unknown"。
const PRICING: Record<string, { in: number; out: number }> = {
  "Qwen/Qwen2.5-72B-Instruct": { in: 0.000972, out: 0.000972 },
  "Qwen/Qwen2.5-7B-Instruct": { in: 0.0000972, out: 0.0000972 },
  "gpt-4o": { in: 0.0025, out: 0.01 },
  "gpt-4o-mini": { in: 0.00015, out: 0.0006 },
  "deepseek-ai/DeepSeek-V3": { in: 0.000194, out: 0.000972 },
};

function priceFor(model: string): { in: number; out: number } | null {
  return PRICING[model] ?? null;
}

function costUsd(model: string, inT: number, outT: number): number | null {
  const p = priceFor(model);
  if (!p) return null;
  return (inT / 1000) * p.in + (outT / 1000) * p.out;
}

async function runOnce(
  label: string,
  endpoint: string,
  apiKey: string,
  model: string,
  brief: string,
): Promise<RunResult> {
  const client = new OpenAI({ apiKey, baseURL: endpoint });
  const start = Date.now();
  try {
    const resp = await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: brief }],
      max_tokens: 300,
      temperature: 0.3,
      stream: false,
    });
    const ms = Date.now() - start;
    const usage = resp.usage;
    const content = resp.choices?.[0]?.message?.content ?? null;
    return {
      label,
      endpoint,
      model,
      reachable: true,
      latencyMs: ms,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      content,
    };
  } catch (err: any) {
    return {
      label,
      endpoint,
      model,
      reachable: false,
      latencyMs: null,
      inputTokens: null,
      outputTokens: null,
      content: null,
      error: err?.message ?? String(err),
    };
  }
}

function parseArgs(argv: string[]): { brief: string; cloud: boolean; local: boolean } {
  let brief =
    "用一段话向初学者解释什么是本地优先（local-first）软件架构，并给出两个例子。";
  let cloud = true;
  let local = true;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--brief") brief = argv[++i] ?? brief;
    else if (argv[i] === "--cloud") {
      cloud = true;
      local = false;
    } else if (argv[i] === "--local") {
      local = true;
      cloud = false;
    } else if (!argv[i].startsWith("--") && argv[i]) {
      brief = argv[i];
    }
  }
  return { brief, cloud, local };
}

async function main() {
  const { brief, cloud, local } = parseArgs(process.argv.slice(2));

  const cloudCfg = {
    endpoint: process.env.OPENAI_BASE_URL || "https://api.siliconflow.cn/v1",
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.FAST_MODEL || "Qwen/Qwen2.5-72B-Instruct",
  };
  const localCfg = {
    endpoint: process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434/v1",
    apiKey: process.env.LOCAL_LLM_API_KEY || "ollama",
    model: process.env.LOCAL_LLM_MODEL || "qwen2.5:7b",
  };

  console.log("═══ TrustOS TRST-6.3 Shadow Comparison ═══");
  console.log(`brief: ${brief}\n`);

  const runs: RunResult[] = [];
  if (cloud) {
    if (!cloudCfg.apiKey) {
      console.warn("⚠️  cloud 跳过：OPENAI_API_KEY 未设置");
    } else {
      runs.push(await runOnce("cloud", cloudCfg.endpoint, cloudCfg.apiKey, cloudCfg.model, brief));
    }
  }
  if (local) {
    runs.push(await runOnce("local", localCfg.endpoint, localCfg.apiKey, localCfg.model, brief));
  }

  // ── 报告 ──
  console.log("────────── 延迟 / Token / 成本 ──────────");
  for (const r of runs) {
    if (!r.reachable) {
      console.log(`[${r.label}] ${r.model} @ ${r.endpoint}`);
      console.log(`   ❌ unreachable: ${r.error}`);
      continue;
    }
    const cost = r.inputTokens !== null && r.outputTokens !== null
      ? costUsd(r.model, r.inputTokens, r.outputTokens)
      : null;
    console.log(`[${r.label}] ${r.model} @ ${r.endpoint}`);
    console.log(
      `   latency=${r.latencyMs}ms  in=${r.inputTokens}  out=${r.outputTokens}` +
        (cost !== null ? `  est_cost=$${cost.toFixed(6)}` : "  est_cost=unknown(model not in price table)"),
    );
  }

  // ── 质量（诚实：人工复核，不自动打分）──
  console.log("\n────────── 质量（人工复核项，非自动评分）──────────");
  const reachable = runs.filter((r) => r.reachable && r.content);
  if (reachable.length < 2) {
    console.log("   ⚠️  需要 cloud 与 local 双方均可达才能做对照；当前不足两方，请检查端点/网络。");
  } else {
    for (const r of reachable) {
      const c = r.content!;
      console.log(`[${r.label}] length=${c.length} chars, first 160: ${c.slice(0, 160).replace(/\n/g, " ")}…`);
    }
    console.log("\n   → 质量维度请人工对比：回答完整性 / 技术准确性 / 语言流畅度。脚本不提供自动打分（避免虚假指标）。");
  }

  // ── 差异小结 ──
  console.log("\n────────── 小结 ──────────");
  const c = runs.find((r) => r.label === "cloud" && r.reachable);
  const l = runs.find((r) => r.label === "local" && r.reachable);
  if (c && l && c.latencyMs && l.latencyMs) {
    const ratio = (l.latencyMs / c.latencyMs).toFixed(2);
    console.log(`   local/cloud 延迟比 ≈ ${ratio}x（>1 表示本地更慢）`);
    console.log(`   成本：cloud=${c.inputTokens !== null ? "$" + (costUsd(c.model, c.inputTokens, c.outputTokens!)?.toFixed(6) ?? "unknown") : "n/a"}  vs  local=${l.inputTokens !== null ? "$" + (costUsd(l.model, l.inputTokens, l.outputTokens!)?.toFixed(6) ?? "unknown") : "n/a"}（local 通常为 $0 自托管）`);
  } else {
    console.log("   对照不完整（一方不可达），详见上方各端点状态。");
  }
  console.log("\n*Report generated by TRST-6.3 shadow-compare. Honest note: quality requires human review.*");
}

main().catch((e) => {
  console.error("shadow-compare failed:", e);
  process.exit(1);
});
