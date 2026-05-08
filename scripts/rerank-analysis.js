#!/usr/bin/env node
/**
 * Phase 5.4: Rerank 效率分析脚本（实验框架版）
 *
 * 扩展点：
 *   --experiment-id   标记本次实验 ID，结果输出到 experiments/<id>.json
 *   --json            输出 JSON 格式（供 baseline.js / compare.js 调用）
 *   --days            分析天数窗口（默认 30）
 *
 * 三个核心指标：
 *   1. triggerRate  = did_rerank=true / total
 *   2. changeRate    = (did_rerank=true AND g2 != g3) / did_rerank=true
 *   3. totalCostUSD  ≈ rerank_count × avg_tokens × price_per_1k
 */

import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CONN = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/smartrouter";
const EXP_DIR = path.join(__dirname, "..", "experiments");

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function parseArgs(argv) {
  const result = {};
  for (const a of argv) {
    const idx = a.indexOf("=");
    if (idx === -1) {
      result[a.replace(/^--/, "")] = true;
    } else {
      result[a.slice(2, idx)] = a.slice(idx + 1);
    }
  }
  return result;
}

async function fetchMetrics(client, cutoff) {
  const total = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM delegation_logs WHERE created_at >= $1
  `, [cutoff]);

  const rerankStats = await client.query(`
    SELECT
      COUNT(*)::int AS rerank_count,
      COUNT(*) FILTER (WHERE g2_final_action IS DISTINCT FROM g3_final_action)::int AS changed_count,
      ROUND(AVG(system_confidence)::numeric, 3) AS avg_conf
    FROM delegation_logs
    WHERE created_at >= $1 AND did_rerank = true
  `, [cutoff]);

  const byBucket = await client.query(`
    SELECT
      conf_bucket,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE did_rerank = true)::int AS rerank_count,
      COUNT(*) FILTER (WHERE did_rerank = true AND g2_final_action IS DISTINCT FROM g3_final_action)::int AS changed
    FROM (
      SELECT
        CASE
          WHEN system_confidence < 0.60 THEN '[0.00,0.60)'
          WHEN system_confidence < 0.65 THEN '[0.60,0.65)'
          WHEN system_confidence < 0.70 THEN '[0.65,0.70)'
          WHEN system_confidence < 0.75 THEN '[0.70,0.75)'
          ELSE '[0.75,1.00]'
        END AS conf_bucket,
        did_rerank, g2_final_action, g3_final_action
      FROM delegation_logs
      WHERE created_at >= $1
    ) sub
    GROUP BY 1 ORDER BY 1
  `, [cutoff]);

  const reasons = await client.query(`
    SELECT rr AS rerank_reason, COUNT(*)::int AS cnt,
           SUM(CASE WHEN g2_final_action IS DISTINCT FROM g3_final_action THEN 1 ELSE 0 END)::int AS changed
    FROM (
      SELECT dl.id, dl.g2_final_action, dl.g3_final_action,
             jsonb_array_elements_text(dl.rerank_rules) AS rr
      FROM delegation_logs dl
      WHERE dl.created_at >= $1 AND dl.did_rerank = true
    ) sub GROUP BY rr ORDER BY cnt DESC
  `, [cutoff]);

  return {
    total: total.rows[0].total,
    rerankCount: rerankStats.rows[0].rerank_count,
    changedCount: rerankStats.rows[0].changed_count,
    avgConf: rerankStats.rows[0].avg_conf,
    byBucket: byBucket.rows,
    reasons: reasons.rows
  };
}

function calcDerived(m) {
  const { total, rerankCount, changedCount } = m;
  const wastedReranks = rerankCount - changedCount;
  const EST_INPUT_TOKENS = 500;
  const EST_OUTPUT_TOKENS = 80;
  const COST_PER_1K = 0.001; // USD
  const rerankCostUSD = rerankCount * (EST_INPUT_TOKENS + EST_OUTPUT_TOKENS) / 1000 * COST_PER_1K;
  const wastedCostUSD = wastedReranks * (EST_INPUT_TOKENS + EST_OUTPUT_TOKENS) / 1000 * COST_PER_1K;

  return {
    triggerRate: total > 0 ? +(rerankCount / total * 100).toFixed(2) : 0,
    changeRate: rerankCount > 0 ? +(changedCount / rerankCount * 100).toFixed(2) : null,
    wastedReranks,
    rerankCostUSD: +rerankCostUSD.toFixed(4),
    wastedCostUSD: +wastedCostUSD.toFixed(4)
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = parseInt(args.days ?? "30", 10);
  const experimentId = args["experiment-id"];
  const asJson = args.json === "true";
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const client = new Client({ connectionString: CONN });
  await client.connect();

  const raw = await fetchMetrics(client, cutoff);
  const derived = calcDerived(raw);
  await client.end();

  const result = {
    experimentId: experimentId ?? null,
    generatedAt: new Date().toISOString(),
    windowDays: days,
    cutoff,
    raw,
    derived
  };

  if (asJson || experimentId) {
    if (experimentId) {
      if (!fs.existsSync(EXP_DIR)) fs.mkdirSync(EXP_DIR, { recursive: true });
      const filePath = path.join(EXP_DIR, `${experimentId}.json`);
      fs.writeFileSync(filePath, JSON.stringify(result, null, 2), "utf8");
      console.log(`[rerank-analysis] Results saved to ${filePath}`);
    }
    if (asJson) {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }

  // 人类友好输出
  const { total, rerankCount, changedCount, avgConf, byBucket, reasons } = raw;
  const d = derived;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 5.4 Rerank 效率报告（近 ${days} 天）`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  样本窗口：${cutoff} 至今`);
  console.log(`  总 gating 请求：${total}`);
  console.log(`  触发 rerank 数：${rerankCount}  (triggerRate = ${d.triggerRate}%)`);
  console.log(`  实际改变决策：${changedCount}  (changeRate = ${d.changeRate ?? "N/A"}%)`);
  console.log(`  无效 rerank 数：${d.wastedReranks}`);
  console.log(`  rerank 平均 conf：${avgConf}`);

  console.log(`\n  【按 confidence 区间分布】`);
  console.log(`  ${"区间".padEnd(14)} ${"总数".padEnd(7)} ${"rerank".padEnd(7)} ${"改变".padEnd(7)} ${"trigger%".padEnd(11)} ${"change%"}`);
  console.log(`  ${"-".repeat(60)}`);
  for (const r of byBucket) {
    const triggerPct = r.total > 0 ? +(r.rerank_count / r.total * 100).toFixed(2) : 0;
    const changePct = r.rerank_count > 0 ? +(r.changed / r.rerank_count * 100).toFixed(2) : null;
    console.log(
      `  ${r.conf_bucket.padEnd(14)} ${String(r.total).padEnd(7)} ${String(r.rerank_count).padEnd(7)} ${String(r.changed).padEnd(7)} ${String(triggerPct+"%").padEnd(11)} ${changePct != null ? changePct+"%" : "N/A"}`
    );
  }

  console.log(`\n  【rerank 原因分布】`);
  console.log(`  ${"原因".padEnd(50)} ${"次数".padEnd(6)} ${"改变"}`);
  console.log(`  ${"-".repeat(60)}`);
  for (const r of reasons) {
    console.log(`  ${r.rerank_reason.padEnd(50)} ${String(r.cnt).padEnd(6)} ${r.changed}`);
  }

  console.log(`\n  【成本估算】`);
  console.log(`  假设每次 rerank ≈ 580 tokens`);
  console.log(`  估算 rerank 总成本：$${d.rerankCostUSD}`);
  console.log(`  其中无效 rerank 成本：$${d.wastedCostUSD} (${d.wastedReranks} 次 × 无改变)`);

  console.log(`\n${"=".repeat(60)}`);
  const verdict = d.changeRate < 5
    ? "⚠️  changeRate 极低（<5%），rerank 收益存疑"
    : d.changeRate < 20
    ? "⚠️  changeRate 偏低（<20%），有优化空间"
    : "✅ changeRate 在合理区间";
  console.log(`  ${verdict}`);
  console.log(`${"=".repeat(60)}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
