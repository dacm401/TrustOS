/**
 * diagnose.cjs — 诊断脚本：输入 archive_id，输出全链路状态
 * 使用：node diagnose.cjs <archive_id>
 * 依赖 show-tables.cjs 校准列名
 */
const { Client } = require('pg');
const DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/smartrouter';

async function diagnose(archiveId) {
  if (!archiveId) {
    console.error('用法: node diagnose.cjs <archive_id>');
    process.exit(1);
  }

  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log(`\n🔍 诊断 archive_id: ${archiveId}\n${'='.repeat(60)}`);

  try {
    // 1. task_archives
    const arch = await client.query(
      `SELECT id, user_id, session_id, task_type, state, status, created_at, updated_at
       FROM task_archives WHERE id = $1`, [archiveId]
    );
    console.log('\n📦 task_archives:');
    if (arch.rows.length === 0) {
      console.log('  ❌ 未找到该 archive_id');
    } else {
      const a = arch.rows[0];
      console.log(`  id:          ${a.id}`);
      console.log(`  user_id:     ${a.user_id}`);
      console.log(`  session_id:  ${a.session_id}`);
      console.log(`  task_type:   ${a.task_type}`);
      console.log(`  state:       ${a.state}`);
      console.log(`  created_at:  ${a.created_at}`);
      console.log(`  updated_at:  ${a.updated_at}`);
    }

    // 2. task_commands（archive_id 列存响应里的 task_id）
    const cmds = await client.query(
      `SELECT id, task_id, archive_id, user_id, command_type, worker_hint, status, issued_at
       FROM task_commands WHERE archive_id = $1`, [archiveId]
    );
    console.log('\n📋 task_commands:');
    if (cmds.rows.length === 0) {
      console.log('  ⚠️  无关联 task_commands');
    } else {
      for (const c of cmds.rows) {
        console.log(`  id:           ${c.id}`);
        console.log(`  task_id:      ${c.task_id}`);
        console.log(`  archive_id:   ${c.archive_id}`);
        console.log(`  command_type: ${c.command_type}`);
        console.log(`  worker_hint:  ${c.worker_hint}`);
        console.log(`  status:       ${c.status}`);
        console.log(`  issued_at:    ${c.issued_at}`);
        console.log('  ---');
      }
    }

    // 3. task_worker_results
    const results = await client.query(
      `SELECT id, archive_id, command_id, worker_role, status, summary,
              length(result_json::text) as rlen, tokens_input, tokens_output, cost_usd,
              started_at, completed_at
       FROM task_worker_results WHERE archive_id = $1`, [archiveId]
    );
    console.log('\n⚙️  task_worker_results:');
    if (results.rows.length === 0) {
      console.log('  ⚠️  无 worker 结果（可能尚未完成）');
    } else {
      for (const r of results.rows) {
        console.log(`  id:              ${r.id}`);
        console.log(`  command_id:      ${r.command_id}`);
        console.log(`  worker_role:     ${r.worker_role}`);
        console.log(`  status:          ${r.status}`);
        console.log(`  summary:         ${(r.summary || '').substring(0, 100)}`);
        console.log(`  result_json 长度: ${r.rlen} 字符`);
        console.log(`  tokens_in/out:  ${r.tokens_input}/${r.tokens_output}`);
        console.log(`  cost_usd:       ${r.cost_usd}`);
        console.log(`  started_at:     ${r.started_at}`);
        console.log(`  completed_at:   ${r.completed_at}`);
        console.log('  ---');
      }
    }

    // 4. task_archive_events
    const events = await client.query(
      `SELECT id, event_type, actor, created_at, payload
       FROM task_archive_events WHERE archive_id = $1 ORDER BY created_at`, [archiveId]
    );
    console.log('\n📊 task_archive_events:');
    if (events.rows.length === 0) {
      console.log('  ⚠️  无事件记录');
    } else {
      for (const e of events.rows) {
        console.log(`  event_type:  ${e.event_type}`);
        console.log(`  actor:       ${e.actor}`);
        console.log(`  created_at:  ${e.created_at}`);
        console.log(`  payload:     ${JSON.stringify(e.payload || {}).substring(0, 150)}`);
        console.log('  ---');
      }
    }

    // 5. delegation_logs（delegation_logs 表的 archive_id = task_archives.id）
    // 注意: delegation_logs 表里没有 decision_type 列，有 routed_action
    const logs = await client.query(
      `SELECT id, routing_layer, g2_final_action, g3_final_action, routed_action,
              llm_confidence, system_confidence, latency_ms, cost_usd, created_at
       FROM delegation_logs WHERE task_id = $1`, [archiveId]
    );
    console.log('\n📝 delegation_logs:');
    if (logs.rows.length === 0) {
      console.log('  ⚠️  无 delegation_log');
    } else {
      for (const l of logs.rows) {
        console.log(`  id:                ${l.id}`);
        console.log(`  routing_layer:     ${l.routing_layer}`);
        console.log(`  g2_final_action:  ${l.g2_final_action}`);
        console.log(`  g3_final_action:  ${l.g3_final_action}`);
        console.log(`  routed_action:    ${l.routed_action}`);
        console.log(`  llm_confidence:  ${l.llm_confidence}`);
        console.log(`  system_confidence: ${l.system_confidence}`);
        console.log(`  latency_ms:      ${l.latency_ms}`);
        console.log(`  cost_usd:        ${l.cost_usd}`);
        console.log(`  created_at:      ${l.created_at}`);
      }
    }

    // 诊断总结
    console.log(`\n${'='.repeat(60)}`);
    console.log('📋 诊断总结:');
    const hasArchive = arch.rows.length > 0;
    const hasCommand = cmds.rows.length > 0;
    const hasResult = results.rows.length > 0;
    const archiveState = arch.rows[0]?.state;

    console.log(`  archive 存在:  ${hasArchive ? '✅' : '❌'}`);
    console.log(`  command 存在:  ${hasCommand ? '✅' : '❌'}`);
    console.log(`  worker 结果:   ${hasResult ? '✅' : '❌'}`);
    console.log(`  archive state: ${archiveState || 'N/A'}`);

    if (hasArchive && archiveState === 'done' && hasResult) {
      console.log('\n✅ 全链路正常！');
    } else if (!hasCommand) {
      console.log('\n❌ 断裂：archive 已创建但 task_commands 未写入（router 问题）');
    } else if (!hasResult) {
      console.log('\n❌ 断裂：command 已创建但 worker 未写入结果（worker 问题）');
    } else if (archiveState !== 'done') {
      console.log(`\n❌ 断裂：archive state=${archiveState}，未到 done（SSE/worker 问题）`);
    }

  } catch (e) {
    console.error('❌ 诊断失败:', e.message);
  } finally {
    await client.end();
  }
}

diagnose(process.argv[2]);
