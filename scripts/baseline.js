#!/usr/bin/env node
/**
 * baseline.js — 快照当前 rerank 指标到 CSV
 *
 * 用法：
 *   node scripts/baseline.js [--days 30]
 *
 * 输出：
 *   experiments/baseline-<YYYYMMDD-HHMMSS>.csv
 *
 * CSV 字段（与 compare.js 对齐）：
 *   experiment_id, experiment_type, window_days, generated_at,
 *   total, rerank_count, changed_count, avg_conf,
 *   trigger_rate, change_rate, wasted_reranks,
 *   rerank_cost_usd, wasted_cost_usd,
 *   bucket_[区间], trigger_[区间], change_[区间]
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXP_DIR = path.join(__dirname, "..", "experiments");

const CONN = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/smartrouter";

function parseArgs(argv) {
  const result = {};
  for (const a of argv) {
    const idx = a.indexOf("=");
    if (idx === -1) result[a.replace(/^--/, "")] = true;
    else result[a.slice(2, idx)] = a.slice(idx + 1);
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

  return {
    total: total.rows[0].total,
    rerankCount: rerankStats.rows[0].rerank_count,
    changedCount: rerankStats.rows[0].changed_count,
    avgConf: rerankStats.rows[0].avg_conf,
    byBucket: byBucket.rows
  };
}

function calcDerived(m) {
  const { total, rerankCount, changedCount } = m;
  const wastedReranks = rerankCount - changedCount;
  const COST_PER_1K = 0.001;
  return {
    triggerRate: total > 0 ? +(rerankCount / total * 100).toFixed(4) : 0,
    changeRate: rerankCount > 0 ? +(changedCount / rerankCount * 100).toFixed(4) : 0,
    wastedReranks,
    rerankCostUSD: +(rerankCount * 580 / 1000 * COST_PER_1K).toFixed(4),
    wastedCostUSD: +(wastedReranks * 580 / 1000 * COST_PER_1K).toFixed(4)
  };
}

function toCsvRow(experimentId, type, windowDays, generatedAt, raw, derived) {
  const buckets = {};
  for (const b of raw.byBucket) {
    const key = b.conf_bucket.replace(/[\[\],.)]/g, "_");
    buckets[`bucket_${key}`] = b.total;
    buckets[`trigger_${key}`] = +(b.total > 0 ? b.rerank_count / b.total * 100 : 0).toFixed(4);
    buckets[`change_${key}`] = +(b.rerank_count > 0 ? b.changed / b.rerank_count * 100 : 0).toFixed(4);
  }

  const fields = [
    experimentId,
    type,
    windowDays,
    generatedAt,
    raw.total,
    raw.rerankCount,
    raw.changedCount,
    raw.avgConf,
    derived.triggerRate,
    derived.changeRate,
    derived.wastedReranks,
    derived.rerankCostUSD,
    derived.wastedCostUSD,
    ...Object.values(buckets)
  ];
  return fields.map(v => `"${v}"`).join(",");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = parseInt(args.days ?? "30", 10);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const experimentId = `baseline-${timestamp}`;

  if (!fs.existsSync(EXP_DIR)) fs.mkdirSync(EXP_DIR, { recursive: true });

  const client = new Client({ connectionString: CONN });
  await client.connect();
  const raw = await fetchMetrics(client, cutoff);
  const derived = calcDerived(raw);
  await client.end();

  const csvPath = path.join(EXP_DIR, `${experimentId}.csv`);
  const header = [
    "experiment_id", "experiment_type", "window_days", "generated_at",
    "total", "rerank_count", "changed_count", "avg_conf",
    "trigger_rate", "change_rate", "wasted_reranks",
    "rerank_cost_usd", "wasted_cost_usd",
    "bucket_[0.00,0.60)", "trigger_[0.00,0.60)", "change_[0.00,0.60)",
    "bucket_[0.60,0.65)", "trigger_[0.60,0.65)", "change_[0.60,0.65)",
    "bucket_[0.65,0.70)", "trigger_[0.65,0.70)", "change_[0.65,0.70)",
    "bucket_[0.70,0.75)", "trigger_[0.70,0.75)", "change_[0.70,0.75)",
    "bucket_[0.75,1.00]", "trigger_[0.75,1.00]", "change_[0.75,1.00]"
  ].map(h => `"${h}"`).join(",");

  const row = toCsvRow(experimentId, "baseline", days, now.toISOString(), raw, derived);
  fs.writeFileSync(csvPath, header + "\n" + row + "\n", "utf8");

  console.log(`[baseline] Snapshot saved to ${csvPath}`);
  console.log(`\n  triggerRate = ${derived.triggerRate}%`);
  console.log(`  changeRate  = ${derived.changeRate}%`);
  console.log(`  rerankCost  = $${derived.rerankCostUSD}`);
}

main().catch(e => { console.error(e); process.exit(1); });
