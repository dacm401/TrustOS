#!/usr/bin/env node
/**
 * Sprint 67P E2E: Quality Ledger Hardening — patchFirstBefore / advisory degraded proof
 *
 * 验证 S67P 新增字段：
 *   patchFirstBefore — 质量路由决策前 patch-first 初始状态
 *   patchFirstDegradedByWarning — prefer_full_rewrite advisory 标记
 *
 * 继承 S66P 4-case：
 *   Case 1: Good → patchFirstBefore=true, patchFirstDegradedByWarning=false, patchFirstDowngradedByQuality=false
 *   Case 2: Warning → patchFirstBefore=true, patchFirstDegradedByWarning=true, patchFirstDowngradedByQuality=false
 *   Case 3: Bad → patchFirstBefore=true, patchFirstDegradedByWarning=false, patchFirstDowngradedByQuality=true
 *   Case 4: Security → patchFirstBefore=true, patchFirstDegradedByWarning=false, patchFirstDowngradedByQuality=true
 *
 * 新增 S67P 2-case：
 *   Case P1: 无 activeArtifact → patchFirstBefore=false（初始 ineligible）
 *   Case P2: Good + 存在 activeArtifact → patchFirstBefore=true（全链路 eligible）
 */
import { routeWithManagerDecision } from './src/services/llm-native-router.ts';

async function runOne(label, rawHistory, message, expected) {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await routeWithManagerDecision({
      message,
      user_id: 'test-user',
      session_id: 'test-session',
      turn_id: rawHistory.length,
      history: [],
      language: 'zh',
      rawHistory,
    });
    const qr = result?.requestSummary?.qualityRouting;
    const lm = result?.requestSummary?.localManager;

    console.log('qr:', JSON.stringify(qr));
    console.log('lm:', JSON.stringify({
      patchFirstEligible: lm?.patchFirstEligible,
      patchFirstBefore: lm?.patchFirstBefore,
      patchFirstDegradedByWarning: lm?.patchFirstDegradedByWarning,
      patchFirstDowngradedByQuality: lm?.patchFirstDowngradedByQuality,
      policyRoute: lm?.policyRoute,
      nextAction: lm?.nextAction,
    }));

    // ── Sprint 67P 验收断言 ──────────────────────────────────────
    // source 断言：有先验 verification 时为 last_verification，否则为 no_prior_verification
    const expectedSource = expected.expectedSource ?? 'last_verification';
    const checks = [
      qr?.source === expectedSource,
      qr?.decision === expected.decision,
      lm?.patchFirstBefore === expected.patchFirstBefore,
      lm?.patchFirstDegradedByWarning === expected.patchFirstDegradedByWarning,
      lm?.patchFirstDowngradedByQuality === expected.patchFirstDowngradedByQuality,
    ];

    const allOk = checks.every(Boolean);
    const status = allOk ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | expected: source=${expectedSource}, decision=${expected.decision}, patchFirstBefore=${expected.patchFirstBefore}, degradedByWarning=${expected.patchFirstDegradedByWarning}, downgraded=${expected.patchFirstDowngradedByQuality}`);

    if (!allOk) {
      console.log(`  Got: source=${qr?.source}, decision=${qr?.decision}, patchFirstBefore=${lm?.patchFirstBefore}, degradedByWarning=${lm?.patchFirstDegradedByWarning}, downgraded=${lm?.patchFirstDowngradedByQuality}`);
    }

    return { ok: allOk, qr, lm };
  } catch (e) {
    console.error('Error:', e.message);
    return { ok: false, error: e.message };
  }
}

async function main() {
  const cases = [

    // ── Case P1: 无 activeArtifact，初始 ineligible ──────────────────
    // 历史中无 artifact（create path），quality routing 即使是好分数也不涉及 patch-first
    // patchFirstBefore = false（初始就没有 artifact 可 revision）
    {
      label: 'P1: No activeArtifact (create path)',
      history: [
        { role: 'user', content: '帮我写一个 HTML 页面。' },
        // 注意：assistant 消息没有 artifact meta，即无 activeArtifact
        { role: 'assistant', content: '好的，这是 HTML 页面。' },
      ],
      message: '再加一个标题。',
      expected: {
        decision: 'allow_patch_first', // 无 prior verification，保守允许
        patchFirstBefore: false,       // 初始 ineligible（无 artifact 可 revision）
        patchFirstDegradedByWarning: false,
        patchFirstDowngradedByQuality: false,
        expectedSource: 'no_prior_verification',  // 无 artifact → 无 verification 来源
      },
    },

    // ── Case P2: Good — patchFirstBefore=true, 全链路 eligible ────────
    {
      label: 'P2: Good (score=0.9) — full eligible path',
      history: [
        { role: 'user', content: '帮我写一个 React 组件。' },
        {
          role: 'assistant',
          content: 'React 组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'good-001', artifactId: 'good-001', contentType: 'tsx',
            summaryForManager: 'React 计数器组件',
            verification: {
              enabled: true, passed: true, score: 0.9,
              issues: [],
            },
          },
        },
      ],
      message: '把数字改成中文显示。',
      expected: {
        decision: 'allow_patch_first',
        patchFirstBefore: true,         // 初始 eligible（有 artifact + revision intent）
        patchFirstDegradedByWarning: false,
        patchFirstDowngradedByQuality: false,
      },
    },

    // ── Case 2: Warning — patchFirstDegradedByWarning=true ────────────
    {
      label: 'Case 2: Warning (score=0.75) — advisory degraded',
      history: [
        { role: 'user', content: '帮我写一个 React 组件。' },
        {
          role: 'assistant',
          content: 'React 组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'warn-001', artifactId: 'warn-001', contentType: 'tsx',
            summaryForManager: 'React 组件',
            verification: {
              enabled: true, passed: true, score: 0.75,
              issues: [{ code: 'VF-003', severity: 'warning', message: 'Missing React export default' }],
            },
          },
        },
      ],
      message: '添加一个边框样式。',
      expected: {
        decision: 'prefer_full_rewrite',
        patchFirstBefore: true,           // 初始 eligible
        patchFirstDegradedByWarning: true, // advisory，V0 不强制降级
        patchFirstDowngradedByQuality: false,
      },
    },

    // ── Case 3: Bad — hard downgrade ────────────────────────────────
    {
      label: 'Case 3: Bad (score=0.4) — hard downgrade',
      history: [
        { role: 'user', content: '帮我写一个 React 组件。' },
        {
          role: 'assistant',
          content: 'React 组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'bad-001', artifactId: 'bad-001', contentType: 'tsx',
            summaryForManager: 'React 组件',
            verification: {
              enabled: true, passed: false, score: 0.4,
              issues: [{ code: 'VF-002', severity: 'error', message: 'Empty content' }],
            },
          },
        },
      ],
      message: '把颜色改成红色。',
      expected: {
        decision: 'force_full_rewrite',
        patchFirstBefore: true,            // 初始 eligible
        patchFirstDegradedByWarning: false,
        patchFirstDowngradedByQuality: true, // hard downgrade
      },
    },

    // ── Case 4: Security — block ─────────────────────────────────────
    {
      label: 'Case 4: Security (VF-006) — hard block',
      history: [
        { role: 'user', content: '帮我写一个表单。' },
        {
          role: 'assistant',
          content: '表单代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'sec-001', artifactId: 'sec-001', contentType: 'code',
            summaryForManager: '表单组件',
            verification: {
              enabled: true, passed: false, score: 0.0,
              issues: [{ code: 'VF-006', severity: 'error', message: 'Security violation' }],
            },
          },
        },
      ],
      message: '再添加一个输入框。',
      expected: {
        decision: 'block_or_full_rewrite',
        patchFirstBefore: true,
        patchFirstDegradedByWarning: false,
        patchFirstDowngradedByQuality: true,
      },
    },

    // ── Case P3: 无 verification，但有 activeArtifact ──────────────────
    // 这是 edge case：第一次 revision 时 history 中无 verification
    // patchFirstBefore = true（有 artifact），但 qualityRouting.source = no_prior_verification
    {
      label: 'P3: Has artifact, no prior verification',
      history: [
        { role: 'user', content: '帮我写一个 React 组件。' },
        {
          role: 'assistant',
          content: 'React 组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'new-001', artifactId: 'new-001', contentType: 'tsx',
            summaryForManager: 'React 组件',
            // 注意：没有 verification 字段
          },
        },
      ],
      message: '把按钮改大一点。',
      expected: {
        decision: 'allow_patch_first',      // 无 prior，保守允许
        patchFirstBefore: true,             // 初始 eligible（有 artifact）
        patchFirstDegradedByWarning: false,
        patchFirstDowngradedByQuality: false,
        expectedSource: 'no_prior_verification',  // 有 artifact 但无 verification 记录
      },
    },
  ];

  // 顺序执行，避免日志混乱（并发 Promise.all 会导致日志交叉）
  const results = [];
  for (const c of cases) {
    results.push(await runOne(c.label, c.history, c.message, c.expected));
  }

  const pass = results.filter(x => x.ok).length;
  console.log(`\n═══════════════════════════════════════`);
  console.log(`S67P E2E: ${pass}/${cases.length} passed`);
  console.log(`═══════════════════════════════════════`);

  if (pass < cases.length) {
    process.exit(1);
  }

  // ── Summary table ─────────────────────────────────────────────────
  console.log('\nSprint 67P E2E Summary:');
  console.log('| Case | Decision | patchFirstBefore | degradedByWarning | downgraded | Status |');
  console.log('|---|---|---|---|---|---|');
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const r = results[i];
    const qr = r?.qr;
    const lm = r?.lm;
    const ok = r?.ok ? '✅' : '❌';
    console.log(`| ${c.label} | ${qr?.decision} | ${lm?.patchFirstBefore} | ${lm?.patchFirstDegradedByWarning} | ${lm?.patchFirstDowngradedByQuality} | ${ok} |`);
  }

  process.exit(0);
}

main();
