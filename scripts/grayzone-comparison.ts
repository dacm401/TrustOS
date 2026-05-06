import pg from "pg";
const { Client } = pg;

const CONN = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/smartrouter";

async function main() {
  const client = new Client(CONN);
  await client.connect();

  // grayZone = G2 ∈ {delegate_to_slow, execute_task} + conf∈[0.60, 0.70)
  const grayzone_q = await client.query(`
    SELECT
      g2_final_action,
      COUNT(*) as cnt,
      AVG(system_confidence)::numeric(4,3) as avg_conf,
      SUM(CASE WHEN did_rerank THEN 1 ELSE 0 END) as rerank_cnt,
      SUM(CASE WHEN did_rerank AND g2_final_action != g3_final_action THEN 1 ELSE 0 END) as changed_cnt
    FROM delegation_logs
    WHERE created_at >= NOW() - INTERVAL '30 days'
      AND system_confidence >= 0.60
      AND system_confidence < 0.70
    GROUP BY g2_final_action
    ORDER BY cnt DESC
  `);

  console.log('【grayZone 区间 conf∈[0.60,0.70)，按 G2 action 分布】');
  console.table(grayzone_q.rows);

  const grayzone_shortable = grayzone_q.rows.filter(
    r => r.g2_final_action === 'delegate_to_slow' || r.g2_final_action === 'execute_task'
  );
  const grayzone_saved_rerank = grayzone_shortable.reduce((s, r) => s + parseInt(r.rerank_cnt), 0);
  const grayzone_saved_change = grayzone_shortable.reduce((s, r) => s + parseInt(r.changed_cnt), 0);
  const total_grayzone = grayzone_shortable.reduce((s, r) => s + parseInt(r.cnt), 0);

  console.log('\n【grayZone 短路明细（delegate_to_slow + execute_task）】');
  for (const r of grayzone_shortable) {
    console.log(
      `  G2=${r.g2_final_action}: ${r.cnt} 条, ` +
      `旧 rerank=${r.rerank_cnt}, 旧 change=${r.changed_cnt}`
    );
  }
  console.log(`  合计短路 rerank: ${grayzone_saved_rerank} 次（change: ${grayzone_saved_change}）`);

  // 旧 vs 新（同样 53 条样本）
  const old_rerank = 49;
  const old_change = 1;
  const new_rerank = old_rerank - grayzone_saved_rerank;
  const new_change = old_change - grayzone_saved_change;
  const total_samples = 53;

  console.log('\n【同样 53 条历史样本，三套逻辑对比】');
  console.log(`旧 triggerRate:  ${(old_rerank/total_samples*100).toFixed(1)}%  (${old_rerank}/53)  [changeRate ${(old_change/old_rerank*100).toFixed(1)}% = ${old_change}/${old_rerank}]`);
  console.log(`v1 grayZone:   75.5%  (40/53)  [changeRate 2.5% = 1/40]  ← delegate_to_slow only`);
  console.log(`v2 grayZone:   ${(new_rerank/total_samples*100).toFixed(1)}%  (${new_rerank}/53)  [changeRate ${(new_change/new_rerank*100).toFixed(1)}% = ${new_change}/${new_rerank}]`);
  console.log(`rerank 减少: ${old_rerank - new_rerank} 次（v1 再减 ${grayzone_saved_rerank - (old_rerank - 40)} 次）`);

  await client.end();
}

main().catch(console.error);
