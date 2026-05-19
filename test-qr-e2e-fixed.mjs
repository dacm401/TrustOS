#!/usr/bin/env node
// Sprint 66P E2E: Quality-aware Routing — synthetic history proof
// 4 cases: Good (0.9), Warning (0.75), Bad (0.4), Security (VF-006)
// Each case proves: SSR qualityRouting + SSE qualityRouting are consistent,
// and localManager.patchFirstDowngradedByQuality reflects the routing decision.
import { routeWithManagerDecision } from './src/services/llm-native-router.ts';

async function runOne(label, rawHistory, message, expected) {
  console.log(`\n=== ${label} ===`);
  try {
    const result = await routeWithManagerDecision({
      message,
      user_id: 'test-user',
      session_id: 'test-session',
      turn_id: rawHistory.length,
      history: [],           // managerView.messages (not used for QR in SSR)
      language: 'zh',
      rawHistory,             // Sprint 66P: SSR reads meta.verification from here
    });
    const qr = result?.requestSummary?.qualityRouting;
    const lm = result?.requestSummary?.localManager;
    console.log('qr:', JSON.stringify(qr));
    console.log('lm:', JSON.stringify({ patchFirstEligible: lm?.patchFirstEligible, patchFirstDowngradedByQuality: lm?.patchFirstDowngradedByQuality, policyRoute: lm?.policyRoute, nextAction: lm?.nextAction }));

    const ok = qr?.source === 'last_verification' &&
      qr?.decision === expected.decision &&
      lm?.patchFirstDowngradedByQuality === expected.patchFirstDegraded;
    const status = ok ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} | expected: decision=${expected.decision}, source=last_verification, degraded=${expected.patchFirstDegraded}`);
    if (!ok) {
      console.log(`  Got: decision=${qr?.decision}, source=${qr?.source}, degraded=${lm?.patchFirstDowngradedByQuality}`);
    }
    return { ok, qr, lm };
  } catch (e) {
    console.error('Error:', e.message, e.stack);
    return { ok: false, error: e.message };
  }
}

async function main() {
  const cases = [
    // Case 1: Good artifact — score=0.9 → allow_patch_first
    {
      label: 'Case 1: Good (score=0.9)',
      history: [
        { role: 'user', content: '帮我写一个 React 按钮。' },
        {
          role: 'assistant',
          content: '按钮组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'good-001', artifactId: 'good-001', contentType: 'code',
            summaryForManager: 'React 按钮组件',
            verification: {
              enabled: true, passed: true, score: 0.9,
              issues: [],
            },
          },
        },
      ],
      message: '把按钮改大一点。',
      expected: { decision: 'allow_patch_first', patchFirstDegraded: false },
    },

    // Case 2: Warning artifact — score=0.75 → prefer_full_rewrite (不强制降级 patchFirstEligible)
    {
      label: 'Case 2: Warning (score=0.75)',
      history: [
        { role: 'user', content: '帮我写一个 React 按钮。' },
        {
          role: 'assistant',
          content: '按钮组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'warn-001', artifactId: 'warn-001', contentType: 'code',
            summaryForManager: 'React 按钮组件',
            verification: {
              enabled: true, passed: true, score: 0.75,
              issues: [{ code: 'VF-004', severity: 'warning', message: 'React structure could be improved' }],
            },
          },
        },
      ],
      message: '把按钮颜色改成红色。',
      expected: { decision: 'prefer_full_rewrite', patchFirstDegraded: false },
    },

    // Case 3: Bad artifact — score=0.4 → force_full_rewrite
    {
      label: 'Case 3: Bad (score=0.4)',
      history: [
        { role: 'user', content: '帮我写一个 React 按钮。' },
        {
          role: 'assistant',
          content: '按钮组件代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'bad-001', artifactId: 'bad-001', contentType: 'code',
            summaryForManager: 'React 按钮组件',
            verification: {
              enabled: true, passed: false, score: 0.4,
              issues: [{ code: 'VF-002', severity: 'error', message: 'Empty or invalid artifact content' }],
            },
          },
        },
      ],
      message: '把按钮改大一点。',
      expected: { decision: 'force_full_rewrite', patchFirstDegraded: true },
    },

    // Case 4: Security artifact — VF-006 → block_or_full_rewrite
    {
      label: 'Case 4: Security (VF-006)',
      history: [
        { role: 'user', content: '帮我写一个表单验证。' },
        {
          role: 'assistant',
          content: '表单验证代码。',
          meta: {
            origin: 'worker', contentKind: 'artifact',
            taskId: 'sec-001', artifactId: 'sec-001', contentType: 'code',
            summaryForManager: '表单验证',
            verification: {
              enabled: true, passed: false, score: 0.0,
              issues: [{ code: 'VF-006', severity: 'error', message: 'artifactToManager must be false' }],
            },
          },
        },
      ],
      message: '再添加一个确认密码字段。',
      expected: { decision: 'block_or_full_rewrite', patchFirstDegraded: true },
    },
  ];

  const results = await Promise.all(
    cases.map(c => runOne(c.label, c.history, c.message, c.expected))
  );

  const pass = results.filter(x => x.ok).length;
  console.log(`\n═══════════════════════════════`);
  console.log(`Final: ${pass}/${cases.length} passed`);
  console.log(`═══════════════════════════════`);
  process.exit(pass === cases.length ? 0 : 1);
}

main();
