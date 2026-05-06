#!/usr/bin/env node
/**
 * Phase 5.4: Rerank 效率分析脚本
 *
 * 回答三个核心指标：
 *   1. triggerRate  = did_rerank=true / total gating requests
 *   2. changeRate   = (did_rerank=true AND g2 != g3) / did_rerank=true
 *   3. deltaCost    ≈ rerank_count × avg_rerank_token_cost
 *
 * 用法：
 *   node scripts/rerank-analysis.js [--days N] [--min-conf 0.65] [--dry-run]
 */

import pg from "pg";
const { Client } = pg;

const CONN = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/smartrouter";

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

async function main() {
  const args = Object.fromEntries(
    process.argv.slice(2).map(a => { const [k, v] = a.split("="); return [k.replace("--", ""), v]; })
  );

  const days = parseInt(args.days ?? "30", 10);
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  const client = new Client({ connectionString: CONN });
  await client.connect();

  // ── 1. 总体指标 ──────────────────────────────────────────────────────────────
  const total = await client.query(`
    SELECT COUNT(*)::int AS total
    FROM delegation_logs
    WHERE created_at >= $1
  `, [cutoff]);

  const rerankStats = await client.query(`
    SELECT
      COUNT(*)::int                         AS rerank_count,
      COUNT(*) FILTER (WHERE g2_final_action != g3_final_action)::int AS changed_count,
      ROUND(AVG(system_confidence)::numeric, 3) AS avg_conf
    FROM delegation_logs
    WHERE created_at >= $1 AND did_rerank = true
  `, [cutoff]);

  const totalRows = total.rows[0].total;
  const rerankCount = rerankStats.rows[0].rerank_count;
  const changedCount = rerankStats.rows[0].changed_count;
  const avgConf = rerankStats.rows[0].avg_conf;

  if (totalRows === 0) {
    console.log(`\n[Phase 5.4] No data in last ${days} days. Nothing to analyze.`);
    await client.end();
    return;
  }

  const triggerRate = (rerankCount / totalRows * 100).toFixed(2);
  const changeRate = rerankCount > 0 ? (changedCount / rerankCount * 100).toFixed(2) : "N/A";
  const wastedReranks = rerankCount - changedCount;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Phase 5.4 Rerank 效率报告（近 ${days} 天）`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  样本窗口：${cutoff} 至今`);
  console.log(`  总 gating 请求：${totalRows}`);
  console.log(`  触发 rerank 数：${rerankCount}  (triggerRate = ${triggerRate}%)`);
  console.log(`  实际改变决策：${changedCount}  (changeRate = ${changeRate}%)`);
  console.log(`  无效 rerank 数：${wastedReranks}`);
  console.log(`  rerank 平均 conf：${avgConf}`);

  // ── 2. 按 confidence 区间细分 ───────────────────────────────────────────────
  const byBucket = await client.query(`
    SELECT
      conf_bucket,
      total,
      rerank_count,
      changed,
      trigger_pct,
      change_pct,
      avg_conf
    FROM (
      SELECT
        CASE
          WHEN system_confidence < 0.60 THEN '[0.00, 0.60)'
          WHEN system_confidence < 0.65 THEN '[0.60, 0.65)'
          WHEN system_confidence < 0.70 THEN '[0.65, 0.70)'
          WHEN system_confidence < 0.75 THEN '[0.70, 0.75)'
          ELSE '[0.75, 1.00]'
        END AS conf_bucket,
        COUNT(*)                                              AS total,
        COUNT(*) FILTER (WHERE did_rerank = true)             AS rerank_count,
        COUNT(*) FILTER (WHERE did_rerank = true AND g2_final_action != g3_final_action) AS changed,
        ROUND(COUNT(*) FILTER (WHERE did_rerank = true)::numeric / NULLIF(COUNT(*), 0) * 100, 2) AS trigger_pct,
        ROUND(
          COUNT(*) FILTER (WHERE did_rerank = true AND g2_final_action != g3_final_action)::numeric
          / NULLIF(COUNT(*) FILTER (WHERE did_rerank = true), 0) * 100, 2
        ) AS change_pct,
        ROUND(AVG(system_confidence)::numeric, 3) AS avg_conf
      FROM delegation_logs
      WHERE created_at >= $1
      GROUP BY 1
    ) t
    ORDER BY 1
  `, [cutoff]);

  console.log(`\n  【按 confidence 区间分布】`);
  console.log(`  ${"区间".padEnd(16)} ${"总数".padEnd(7)} ${"rerank".padEnd(7)} ${"改变".padEnd(7)} ${"trigger%".padEnd(11)} ${"change%".padEnd(10)} ${"avg_conf"}`);
  console.log(`  ${"-".repeat(70)}`);
  for (const r of byBucket.rows) {
    const cp = r.change_pct ?? "N/A";
    console.log(
      `  ${(r.conf_bucket).padEnd(16)} ${String(r.total).padEnd(7)} ${String(r.rerank_count).padEnd(7)} ${String(r.changed).padEnd(7)} ${String(r.trigger_pct+"%").padEnd(11)} ${String(cp+"%").padEnd(10)} ${r.avg_conf}`
    );
  }

  // ── 3. rerank 原因分布（诊断：60% 的 rerank 应该消失？） ──────────────────
  const reasons = await client.query(`
    SELECT
      rr AS rerank_reason,
      COUNT(*) AS cnt,
      COUNT(*) FILTER (WHERE g2_final_action != g3_final_action) AS changed
    FROM (
      SELECT jsonb_array_elements_text(rerank_rules) AS rr
      FROM delegation_logs
      WHERE created_at >= $1 AND did_rerank = true
    ) sub
    GROUP BY rr
    ORDER BY cnt DESC
  `, [cutoff]);

  console.log(`\n  【rerank 原因分布】`);
  console.log(`  ${"原因".padEnd(52)} ${"次数".padEnd(6)} ${"改变决策"}`);
  console.log(`  ${"-".repeat(70)}`);
  for (const r of reasons.rows) {
    console.log(`  ${r.rerank_reason.padEnd(52)} ${String(r.cnt).padEnd(6)} ${r.changed}`);
  }

  // ── 4. 成本估算（假设 rerank 每次 ~500 input + 80 output tokens） ─────────
  // SiliconFlow Qwen2.5-72B 定价：$0.001/1K input, $0.001/1K output
  const EST_INPUT_TOKENS = 500;
  const EST_OUTPUT_TOKENS = 80;
  const COST_PER_1K = 0.001; // USD
  const rerankCostUSD = rerankCount * (EST_INPUT_TOKENS + EST_OUTPUT_TOKENS) / 1000 * COST_PER_1K;
  const wastedCostUSD = wastedReranks * (EST_INPUT_TOKENS + EST_OUTPUT_TOKENS) / 1000 * COST_PER_1K;
  console.log(`\n  【成本估算】`);
  console.log(`  假设每次 rerank ≈ ${EST_INPUT_TOKENS + EST_OUTPUT_TOKENS} tokens`);
  console.log(`  估算 rerank 总成本：$${rerankCostUSD.toFixed(4)}`);
  console.log(`  其中无效 rerank 成本：$${wastedCostUSD.toFixed(4)} (${wastedReranks} 次 × 无改变)`);

  // ── 5. 结论 ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(60)}`);
  const verdict =
    changeRate !== "N/A" && parseFloat(changeRate) < 5
      ? "⚠️  changeRate 极低（<5%），rerank 收益存疑，建议缩小触发条件"
      : changeRate !== "N/A" && parseFloat(changeRate) < 20
      ? "⚠️  changeRate 偏低（<20%），有优化空间"
      : "✅ changeRate 在合理区间";
  console.log(`  ${verdict}`);
  console.log(`${"=".repeat(60)}\n`);

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
