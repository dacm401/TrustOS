/**
 * Sprint 68P E2E: Patch-first Final State Ledger — runtime proof
 *
 * 验证 S68P 新增字段（E1–E8）：
 *   qualityRouting.patchQuality: before/after/warningAdvisory/hardDowngrade/degradeReason
 *   localManager.effectivePatchFirstEligible
 *   localManager.patchFirstWarningAdvisory / patchFirstHardDowngrade (aliases)
 *
 * Approach: 直接链式调用，不走 routeWithManagerDecision 完整 SSR
 *           （完整 SSR 调用 retrieveMemoriesHybrid 需要 DB 连接，会 hang）
 *           链式调用顺序与 SSE done 完全一致：
 *             extractLastVerificationFromHistory
 *             → evaluateQualityRouting
 *             → runLocalManager
 *             → localManagerToLedgerExtract
 *             → qualityRoutingLedgerEntry (模拟 buildRequestLedger)
 *
 * E1: Good — no degrade
 * E2: Warning — advisory degraded (patchQuality.warningAdvisory=true)
 * E3: Bad — hard downgrade (patchQuality.after=false)
 * E4: Security VF-006 — hard block
 * E5: No activeArtifact — initial ineligible
 * E6: Has artifact, no prior verification
 * E7: Bad quality — patchQuality.after=false (S68P core)
 * E8: Warning advisory — patchQuality归位 (S68P core)
 */
import { describe, it, expect } from 'vitest';
import { extractLastVerificationFromHistory, evaluateQualityRouting } from '../../../src/services/verifier/quality-router.js';
import { runLocalManager, localManagerToLedgerExtract } from '../../../src/services/manager/local-manager-runtime.js';

function buildQRLedger(history: any[], message: string) {
  const lastVerif = extractLastVerificationFromHistory(history, undefined);
  const qr = evaluateQualityRouting('artifact-1', lastVerif);

  const lm = runLocalManager({
    traceId: 'test-trace',
    userInstruction: message,
    activeArtifact: lastVerif ? { artifactId: 'artifact-1', summaryForManager: 'test' } : undefined,
    qualityRouting: qr,
  });

  const lmExtract = localManagerToLedgerExtract(lm);

  // S68P: 模拟 buildRequestLedger 中 qualityRouting.patchQuality 注入逻辑
  const degradeReason = lm.patchFirstEligible !== lm.patchFirstBefore
    ? `quality downgrade: ${qr.decision}`
    : lm.patchFirstWarningAdvisory
      ? `advisory warning: ${qr.decision}`
      : undefined;

  const patchQuality = {
    before: lm.patchFirstBefore,
    after: lm.effectivePatchFirstEligible,
    warningAdvisory: lm.patchFirstWarningAdvisory ?? false,
    hardDowngrade: lm.patchFirstHardDowngrade ?? false,
    degradeReason,
  };

  return { qr, lm, lmExtract, patchQuality };
}

function withMeta(meta: any) {
  return { role: 'assistant', content: 'code', meta };
}

describe('Sprint 68P E2E — Patch-first Final State Ledger (chain call)', () => {

  it('E1: Good — patchQuality.before=true, after=true, no degrade', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 'g1', artifactId: 'g1',
      verification: { enabled: true, passed: true, score: 0.9, issues: [] },
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '把数字改成中文');
    expect(qr.decision).toBe('allow_patch_first');
    expect(patchQuality.before).toBe(true);
    expect(patchQuality.after).toBe(true);
    expect(patchQuality.warningAdvisory).toBe(false);
    expect(patchQuality.hardDowngrade).toBe(false);
    expect(lm.effectivePatchFirstEligible).toBe(true);
    expect(lm.patchFirstWarningAdvisory).toBe(false);
    expect(lm.patchFirstHardDowngrade).toBe(false);
  });

  it('E2: Warning advisory — patchQuality.warningAdvisory=true, after=true (S68P core)', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 'w1', artifactId: 'w1',
      verification: { enabled: true, passed: true, score: 0.75,
        issues: [{ code: 'VF-003', severity: 'warning', message: 'Missing export' }] },
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '添加边框样式');
    expect(qr.decision).toBe('prefer_full_rewrite');
    expect(patchQuality.before).toBe(true);
    expect(patchQuality.after).toBe(true);
    expect(patchQuality.warningAdvisory).toBe(true);
    expect(patchQuality.hardDowngrade).toBe(false);
    expect(lm.effectivePatchFirstEligible).toBe(true);
    expect(lm.patchFirstWarningAdvisory).toBe(true);
    expect(lm.patchFirstHardDowngrade).toBe(false);
  });

  it('E3: Bad — patchQuality.after=false, hardDowngrade=true (S68P core)', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 'b1', artifactId: 'b1',
      verification: { enabled: true, passed: false, score: 0.4,
        issues: [{ code: 'VF-002', severity: 'error', message: 'Empty content' }] },
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '把颜色改成红色');
    expect(qr.decision).toBe('force_full_rewrite');
    expect(patchQuality.before).toBe(true);
    expect(patchQuality.after).toBe(false);
    expect(patchQuality.warningAdvisory).toBe(false);
    expect(patchQuality.hardDowngrade).toBe(true);
    expect(lm.effectivePatchFirstEligible).toBe(false);
    expect(lm.patchFirstWarningAdvisory).toBe(false);
    expect(lm.patchFirstHardDowngrade).toBe(true);
  });

  it('E4: Security VF-006 — hard block, after=false', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 's1', artifactId: 's1',
      verification: { enabled: true, passed: false, score: 0.0,
        issues: [{ code: 'VF-006', severity: 'error', message: 'Security violation' }] },
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '添加输入框');
    expect(qr.decision).toBe('block_or_full_rewrite');
    expect(patchQuality.before).toBe(true);
    expect(patchQuality.after).toBe(false);
    expect(patchQuality.hardDowngrade).toBe(true);
    expect(lm.effectivePatchFirstEligible).toBe(false);
    expect(lm.patchFirstHardDowngrade).toBe(true);
  });

  it('E5: No activeArtifact — patchQuality.before=false, after=false', () => {
    const history = [{ role: 'user', content: 'hello' }];
    const { qr, lm, patchQuality } = buildQRLedger(history, '再加一个标题');
    expect(qr.decision).toBe('allow_patch_first');
    expect(patchQuality.before).toBe(false);
    expect(patchQuality.after).toBe(false);
    expect(lm.patchFirstBefore).toBe(false);
    expect(lm.effectivePatchFirstEligible).toBe(false);
  });

  it('E6: Has artifact, no prior verification — before=false (no quality to assess)', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 'n1', artifactId: 'n1',
      // no verification field
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '把按钮改大一点');
    // 有 artifact 但无 quality verification → 无法评估 → patch-first ineligible
    expect(qr.decision).toBe('allow_patch_first');  // QR no-prior → conservative allow
    expect(patchQuality.before).toBe(false);   // 无 quality signal → ineligible
    expect(patchQuality.after).toBe(false);
    expect(lm.patchFirstBefore).toBe(false);
    expect(lm.effectivePatchFirstEligible).toBe(false);
  });

  it('E7: Bad quality hard downgrade — effectivePatchFirstEligible=false, after=false (S68P core)', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 'b7', artifactId: 'b7',
      verification: { enabled: true, passed: false, score: 0.35,
        issues: [{ code: 'VF-002', severity: 'error', message: 'Critical render error' }] },
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '把颜色改成蓝色');
    // S68P core claim: patchQuality.after is explicitly set
    expect(patchQuality.after).toBe(false);
    expect(patchQuality.hardDowngrade).toBe(true);
    expect(lm.effectivePatchFirstEligible).toBe(false);
    expect(qr.decision).toBe('force_full_rewrite');
  });

  it('E8: Warning advisory — patchQuality归位, warningAdvisory=true (S68P core)', () => {
    const history = [withMeta({
      origin: 'worker', contentKind: 'artifact', taskId: 'w8', artifactId: 'w8',
      verification: { enabled: true, passed: true, score: 0.72,
        issues: [{ code: 'VF-003', severity: 'warning', message: 'Missing type annotation' }] },
    })];
    const { qr, lm, patchQuality } = buildQRLedger(history, '添加日志输出');
    // S68P core claim: patchQuality归位到 qualityRouting
    expect(patchQuality.warningAdvisory).toBe(true);
    expect(patchQuality.hardDowngrade).toBe(false);
    expect(patchQuality.after).toBe(true);
    expect(lm.patchFirstWarningAdvisory).toBe(true);
    expect(qr.decision).toBe('prefer_full_rewrite');
  });

});
