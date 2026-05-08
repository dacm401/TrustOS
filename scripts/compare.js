#!/usr/bin/env node
/**
 * compare.js — 对比两个 experiment CSV 文件
 *
 * 用法：
 *   node scripts/compare.js <exp1.csv> <exp2.csv>
 *   node scripts/compare.js <exp1-id> <exp2-id>     # 自动拼接 experiments/<id>.csv
 *
 * 输出：
 *   对比表格（人类友好）+ delta 值
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXP_DIR = path.join(__dirname, "..", "experiments");

function resolvePath(id) {
  if (id.endsWith(".csv")) return path.isAbsolute(id) ? id : path.join(EXP_DIR, id);
  return path.join(EXP_DIR, `${id}.csv`);
}

/**
 * 简单 CSV 解析器：处理带引号和逗号的字段
 * e.g. `"bucket_[0.00,0.60)"` 不会被 `,` 分割
 */
function parseCsvLine(line) {
  const fields = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === '"') {
      // quoted field
      let j = i + 1;
      while (j < line.length) {
        if (line[j] === '"' && line[j + 1] === '"') { j += 2; continue; } // escaped quote
        if (line[j] === '"') { j++; break; }
        j++;
      }
      fields.push(line.slice(i + 1, j - 1).replace(/""/g, '"'));
      i = j;
      if (line[i] === ',') i++;
    } else {
      // unquoted field
      const next = line.indexOf(',', i);
      if (next === -1) { fields.push(line.slice(i)); break; }
      fields.push(line.slice(i, next));
      i = next + 1;
    }
  }
  return fields;
}

function loadCsv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  const lines = raw.split("\n");
  const headers = parseCsvLine(lines[0]);
  const values = parseCsvLine(lines[1]);
  return Object.fromEntries(headers.map((h, i) => [h.trim(), values[i]?.trim() ?? null]));
}

function fmt(v) { return v == null ? "N/A" : v; }
function num(v) { return v === "N/A" || v == null ? null : parseFloat(v); }
function delta(a, b) {
  const na = num(a), nb = num(b);
  if (na == null || nb == null) return "—";
  const d = nb - na;
  const sign = d >= 0 ? "+" : "";
  return `${sign}${d.toFixed(4)}`;
}
function isNum(v) { return v != null && v !== "N/A" && !isNaN(parseFloat(v)); }

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error("用法: node scripts/compare.js <exp1.csv|exp1-id> <exp2.csv|exp2-id>");
    process.exit(1);
  }

  const [id1, id2] = args;
  const p1 = resolvePath(id1);
  const p2 = resolvePath(id2);

  if (!fs.existsSync(p1)) { console.error(`[compare] File not found: ${p1}`); process.exit(1); }
  if (!fs.existsSync(p2)) { console.error(`[compare] File not found: ${p2}`); process.exit(1); }

  const e1 = loadCsv(p1);
  const e2 = loadCsv(p2);

  console.log(`\n${"=".repeat(70)}`);
  console.log(`  Rerank 实验对比`);
  console.log(`${"=".repeat(70)}`);
  console.log(`  ${"指标".padEnd(22)} ${fmt(e1.experiment_id).padEnd(22)} ${fmt(e2.experiment_id).padEnd(16)} Delta`);
  console.log(`  ${"-".repeat(70)}`);

  const rows = [
    ["experiment_type", "类型",        false],
    ["window_days",     "窗口天数",    false],
    ["generated_at",    "生成时间",    false],
    ["total",           "总请求数",    true],
    ["rerank_count",    "rerank次数",  true],
    ["changed_count",   "改变决策数",  true],
    ["avg_conf",        "平均conf",    true],
    ["trigger_rate",    "triggerRate%", true],
    ["change_rate",     "changeRate%",  true],
    ["wasted_reranks",  "无效rerank",   true],
    ["rerank_cost_usd", "rerank成本($)", true],
    ["wasted_cost_usd", "无效成本($)",  true],
  ];

  for (const [key, label, isNumCol] of rows) {
    const v1 = fmt(e1[key]);
    const v2 = fmt(e2[key]);
    const d = isNumCol ? delta(e1[key], e2[key]) : "—";
    console.log(`  ${label.padEnd(22)} ${v1.padEnd(22)} ${v2.padEnd(16)} ${d}`);
  }

  // 按区间对比
  const bucketKeys = [
    "[0.00,0.60)", "[0.60,0.65)", "[0.65,0.70)", "[0.70,0.75)", "[0.75,1.00]"
  ];

  console.log(`\n  【按 confidence 区间】`);
  for (const b of bucketKeys) {
    const t1 = fmt(e1[`trigger_${b}`]);
    const t2 = fmt(e2[`trigger_${b}`]);
    const c1 = fmt(e1[`change_${b}`]);
    const c2 = fmt(e2[`change_${b}`]);
    const td = isNum(t1) && isNum(t2) ? delta(e1[`trigger_${b}`], e2[`trigger_${b}`]) : "—";
    console.log(`  ${b.padEnd(16)} trigger: ${t1.padEnd(8)}→${t2.padEnd(8)} (${td})  change: ${c1}→${c2}`);
  }

  console.log(`${"=".repeat(70)}\n`);

  // 简短结论
  const triggerD = num(e2.trigger_rate) - num(e1.trigger_rate);
  const changeD = num(e2.change_rate) - num(e1.change_rate);
  console.log(`  📊 结论：`);
  if (triggerD !== null && Math.abs(triggerD) > 0.1) {
    console.log(`     triggerRate ${triggerD >= 0 ? "↑" : "↓"} ${Math.abs(triggerD).toFixed(2)}pp`);
  }
  if (changeD !== null && Math.abs(changeD) > 1) {
    console.log(`     changeRate ${changeD >= 0 ? "↑" : "↓"} ${Math.abs(changeD).toFixed(2)}pp`);
  }
  console.log();
}

main().catch(e => { console.error(e); process.exit(1); });
