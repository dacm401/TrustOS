/**
 * Sprint 72P: Task Contract V0 — 单测 + D4/D5 集成测试
 *
 * D1: Schema 单元测试
 * D2: Contract builder 测试
 * D3: Ledger audit extract 测试
 * D4: No-routing-divergence guard（保护 S66P-S71P proof pyramid）
 * D5: Context Boundary regression guards（sentinel 负面测试）
 * D6: Verifier 兼容测试
 */

import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";

import {
  buildTaskContract,
  buildTaskContractAuditExtract,
  SENTINELS,
  containsSentinel,
  containsAnySentinel,
} from "../../../src/services/task-contract/index.js";

import type {
  TaskContractV0,
  TaskContractBuilderInput,
  TaskIntent,
  ExpectedOutputKind,
  RiskLevel,
} from "../../../src/services/task-contract/index.js";

import { runLocalManager } from "../../../src/services/manager/local-manager-runtime.js";
import type { LocalManagerDecision } from "../../../src/services/manager/local-manager-runtime.js";
import type { QualityRoutingDecision } from "../../../src/services/verifier/verifier-types.js";
import { evaluateQualityRouting } from "../../../src/services/verifier/quality-router.js";
import type { VerificationLedgerEntry } from "../../../src/services/verifier/verifier-types.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeQrEntry(
  score: number,
  passed: boolean,
  errorCount = 0
): VerificationLedgerEntry {
  return {
    enabled: true,
    verifierVersion: "v0",
    targetType: "artifact",
    passed,
    score,
    issueCount: errorCount,
    errorCount,
    warningCount: 0,
    issues: [],
    decisionMs: 1,
  };
}

// ── TC-001: Schema 编译测试 ─────────────────────────────────────────────────

describe("TaskContractV0 schema", () => {
  it("TC-001: TaskContractV0 类型可正常构造", () => {
    const contract: TaskContractV0 = {
      id: uuid(),
      taskId: "trace-1",
      intent: "create_artifact",
      expectedOutputKind: "artifact",
      target: {},
      userVisibleGoal: "Create a React component",
      acceptanceCriteria: ["Component renders correctly"],
      constraints: [],
      allowedContext: {
        canReadHistory: false,
        canReadArtifactSource: false,
        artifactIds: [],
        memoryScope: "none",
      },
      riskLevel: "low",
      budgetPolicy: { maxWorkerCalls: 1, maxVerifierCalls: 0, maxCycles: 1 },
      verificationPolicy: {
        required: false,
        mode: "none",
        criteriaSource: "human_acceptance_criteria",
        blockOnSecurity: false,
      },
      provenance: { builtFrom: "fallback" },
    };

    expect(contract.id).toBeTruthy();
    expect(contract.intent).toBe("create_artifact");
    expect(contract.verificationPolicy.criteriaSource).toBe("human_acceptance_criteria");
    expect(contract.budgetPolicy.maxCycles).toBe(1);
  });

  it("TC-002: verificationPolicy.mode 可为 none/heuristic/llm", () => {
    const modes = ["none", "heuristic", "llm"] as const;
    for (const mode of modes) {
      const contract: TaskContractV0 = {
        id: uuid(), taskId: "t1", intent: "answer",
        expectedOutputKind: "answer", target: {},
        userVisibleGoal: "Test", acceptanceCriteria: [], constraints: [],
        allowedContext: { canReadHistory: false, canReadArtifactSource: false, artifactIds: [], memoryScope: "none" },
        riskLevel: "low",
        budgetPolicy: { maxWorkerCalls: 1, maxVerifierCalls: 0, maxCycles: 1 },
        verificationPolicy: {
          required: false, mode,
          criteriaSource: "human_acceptance_criteria",
          blockOnSecurity: false,
        },
        provenance: { builtFrom: "fallback" },
      };
      expect(contract.verificationPolicy.mode).toBe(mode);
    }
  });

  it("TC-003: allowedContext.artifactIds 可以有值", () => {
    const contract: TaskContractV0 = {
      id: uuid(), taskId: "t1", intent: "revise_artifact",
      expectedOutputKind: "patch", target: { artifactId: "art-1" },
      userVisibleGoal: "Test", acceptanceCriteria: [], constraints: [],
      allowedContext: {
        canReadHistory: false,
        canReadArtifactSource: true,
        artifactIds: ["art-1"],
        memoryScope: "none",
      },
      riskLevel: "medium",
      budgetPolicy: { maxWorkerCalls: 2, maxVerifierCalls: 1, maxCycles: 2 },
      verificationPolicy: {
        required: true, mode: "heuristic",
        criteriaSource: "human_acceptance_criteria",
        blockOnSecurity: false,
      },
      provenance: { builtFrom: "localManager" },
    };
    expect(contract.allowedContext.artifactIds).toEqual(["art-1"]);
    expect(contract.target.artifactId).toBe("art-1");
  });
});

// ── TC-100: Contract Builder ────────────────────────────────────────────────

describe("buildTaskContract", () => {
  const traceId = "trace-builder-1";

  it("TC-101: create_artifact intent → expectedOutputKind=artifact", () => {
    const lm = runLocalManager({ traceId, userInstruction: "Create a dashboard component" });
    const contract = buildTaskContract({ traceId, userInstruction: "Create a dashboard component", localManager: lm });
    expect(contract.intent).toBe("create_artifact");
    expect(contract.expectedOutputKind).toBe("artifact");
  });

  it("TC-102: direct_artifact_revision → intent=revise_artifact", () => {
    // 用 pre-constructed LocalManagerDecision（避免 activeArtifact 字段兼容性问题）
    const lm: LocalManagerDecision = {
      traceId,
      managerMode: "local_control_plane",
      managerLlmRequired: false,
      policyRoute: "direct_artifact_revision",
      nextAction: "direct_artifact_revision",
      contextPackageRequired: true,
      patchFirstEligible: true,
      effectivePatchFirstEligible: true,
      patchFirstBefore: true,
      security: {
        allowManagerRemote: true,
        allowWorkerRemote: true,
        allowArtifactToManager: false,
        allowArtifactToWorker: true,
        allowRawHistoryToWorker: false,
        allowRawMemoryToWorker: false,
      },
      decisionMs: 1,
      reason: "test",
    };
    const contract = buildTaskContract({
      traceId,
      userInstruction: "Fix the button bug",
      localManager: lm,
      targetArtifactId: "art-fix-1",
    });
    expect(contract.intent).toBe("revise_artifact");
    expect(contract.expectedOutputKind).toBe("patch");
  });

  it("TC-103: qualityRouting=allow_patch_first → riskLevel=low", () => {
    const entry = makeQrEntry(0.9, true);
    const qr = evaluateQualityRouting("art-1", entry);
    const contract = buildTaskContract({ traceId, userInstruction: "Fix it", qualityRouting: qr });
    expect(contract.riskLevel).toBe("low");
    expect(contract.verificationPolicy.required).toBe(false);
    expect(contract.budgetPolicy.maxWorkerCalls).toBe(1);
  });

  it("TC-104: qualityRouting=prefer_full_rewrite → riskLevel=medium", () => {
    const entry = makeQrEntry(0.75, true);
    const qr = evaluateQualityRouting("art-1", entry);
    const contract = buildTaskContract({ traceId, userInstruction: "Improve it", qualityRouting: qr });
    expect(contract.riskLevel).toBe("medium");
    expect(contract.verificationPolicy.required).toBe(true);
    expect(contract.verificationPolicy.mode).toBe("heuristic");
    expect(contract.budgetPolicy.maxCycles).toBe(2);
  });

  it("TC-105: qualityRouting=force_full_rewrite → riskLevel=high", () => {
    const entry = makeQrEntry(0.35, false);
    const qr = evaluateQualityRouting("art-1", entry);
    const contract = buildTaskContract({ traceId, userInstruction: "Rewrite it", qualityRouting: qr });
    expect(contract.riskLevel).toBe("high");
    expect(contract.verificationPolicy.required).toBe(true);
    expect(contract.verificationPolicy.mode).toBe("llm");
    expect(contract.verificationPolicy.minScore).toBe(0.5);
    expect(contract.budgetPolicy.maxWorkerCalls).toBe(3);
  });

  it("TC-106: qualityRouting=block_or_full_rewrite → riskLevel=security", () => {
    const entry = makeQrEntry(0.0, false, 1);
    entry.issues = [{ code: "VF-006", severity: "error", message: "Security" }];
    const qr = evaluateQualityRouting("art-1", entry);
    const contract = buildTaskContract({ traceId, userInstruction: "Do it", qualityRouting: qr });
    expect(contract.riskLevel).toBe("security");
    expect(contract.verificationPolicy.blockOnSecurity).toBe(true);
    expect(contract.budgetPolicy.maxCycles).toBe(1);
  });

  it("TC-107: provenance.builtFrom=localManager，qualityDecision 正确记录", () => {
    // pre-constructed LM with patchFirstEligible=true（nextAction=direct_artifact_revision + managerLlmRequired=false）
    const lm: LocalManagerDecision = {
      traceId,
      managerMode: "local_control_plane",
      managerLlmRequired: false,
      policyRoute: "direct_artifact_revision",
      nextAction: "direct_artifact_revision",
      contextPackageRequired: true,
      patchFirstEligible: true,
      effectivePatchFirstEligible: true,
      patchFirstBefore: true,
      security: {
        allowManagerRemote: true, allowWorkerRemote: true,
        allowArtifactToManager: false, allowArtifactToWorker: true,
        allowRawHistoryToWorker: false, allowRawMemoryToWorker: false,
      },
      decisionMs: 1, reason: "test",
    };
    const qr: QualityRoutingDecision = {
      enabled: true,
      source: "last_verification",
      lastScore: 0.9,
      decision: "allow_patch_first",
      reason: "high score",
      decisionMs: 1,
    };
    const contract = buildTaskContract({ traceId, userInstruction: "Fix bug", localManager: lm, qualityRouting: qr });
    expect(contract.provenance.builtFrom).toBe("localManager");
    expect(contract.provenance.qualityDecision).toBe("allow_patch_first");
    expect(contract.provenance.patchFirstEligible).toBe(true);
  });

  it("TC-108: fallback（无 localManager）时 builtFrom=fallback，riskLevel=low", () => {
    const contract = buildTaskContract({ traceId, userInstruction: "Hello" });
    expect(contract.provenance.builtFrom).toBe("fallback");
    expect(contract.riskLevel).toBe("low");
  });

  it("TC-109: userVisibleGoal 为 userInstruction 截取（>200字符）", () => {
    const longInstruction = "A".repeat(300);
    const contract = buildTaskContract({ traceId, userInstruction: longInstruction });
    expect(contract.userVisibleGoal.length).toBeLessThanOrEqual(200);
    expect(contract.userVisibleGoal.endsWith("...")).toBe(true);
  });

  it("TC-110: acceptanceCriteria 和 constraints 可接受自定义值", () => {
    const criteria = ["Has export default", "No console.log"];
    const contract = buildTaskContract({
      traceId,
      userInstruction: "Create component",
      acceptanceCriteria: criteria,
      constraints: ["No external deps"],
    });
    expect(contract.acceptanceCriteria).toEqual(criteria);
    expect(contract.constraints).toEqual(["No external deps"]);
  });
});

// ── TC-200: Ledger Audit Extract ────────────────────────────────────────────

describe("buildTaskContractAuditExtract", () => {
  it("TC-201: audit extract 不含 acceptanceCriteria / constraints / userVisibleGoal 全文", () => {
    const contract = buildTaskContract({
      traceId: "t1",
      userInstruction: "Create a dashboard component with export default and no console.error",
      acceptanceCriteria: ["Has export default", "No console.error"],
      constraints: ["Must use React 18"],
    });
    const audit = buildTaskContractAuditExtract(contract);

    // audit extract 不应包含这些字段
    expect("acceptanceCriteria" in audit).toBe(false);
    expect("constraints" in audit).toBe(false);
    expect("userVisibleGoal" in audit).toBe(false);

    // audit extract 必须包含的字段
    expect(audit.id).toBe(contract.id);
    expect(audit.taskId).toBe(contract.taskId);
    expect(audit.intent).toBe(contract.intent);
    expect(audit.expectedOutputKind).toBe(contract.expectedOutputKind);
    expect(audit.riskLevel).toBe(contract.riskLevel);
  });

  it("TC-202: artifactIds 不在 audit extract 中展开（artifactIdsListed=false）", () => {
    const contract = buildTaskContract({
      traceId: "t1",
      userInstruction: "Fix it",
      targetArtifactId: "art-secret-123",
    });
    const audit = buildTaskContractAuditExtract(contract);

    expect(audit.allowedContextAudit.artifactIdCount).toBe(1);
    expect(audit.allowedContextAudit.artifactIdsListed).toBe(false);
    expect(audit.allowedContextAudit.hasTargetArtifactId).toBe(true);
  });

  it("TC-203: audit extract 包含 provenance", () => {
    const contract = buildTaskContract({ traceId: "t1", userInstruction: "Hello" });
    const audit = buildTaskContractAuditExtract(contract);
    expect(audit.provenance.builtFrom).toBeTruthy();
  });
});

// ── TC-300: D4 — No-routing-divergence Guard ────────────────────────────────

/**
 * D4: 证明添加 TaskContract 不改变现有 routing decision。
 *
 * 这是保护 S66P-S71P proof pyramid 的关键 regression guard。
 * buildTaskContract 纯粹是投影，不应改变 qualityRouting / localManager 的任何字段。
 */
describe("D4: No-routing-divergence guard", () => {
  it("D4-001: buildTaskContract 不改变 qualityRouting.decision", () => {
    const traceId = "diverge-test-1";
    const qrBefore = evaluateQualityRouting("art-1", makeQrEntry(0.9, true));
    expect(qrBefore.decision).toBe("allow_patch_first");

    // 加入 contract 后，qualityRouting 不变
    const contract = buildTaskContract({ traceId, userInstruction: "Fix it", qualityRouting: qrBefore });

    // contract 正确派生 riskLevel，但不影响 qr.decision
    expect(contract.riskLevel).toBe("low");
    expect(qrBefore.decision).toBe("allow_patch_first"); // 未被修改
  });

  it("D4-002: buildTaskContract 不改变 localManager.patchFirstEligible", () => {
    const traceId = "diverge-test-2";
    const lm = runLocalManager({
      traceId,
      userInstruction: "Fix bug",
      activeArtifact: { artifactId: "art-x", artifactContent: "x", artifactType: "text", revisionMessage: "x" },
    });
    const before = lm.patchFirstEligible;

    buildTaskContract({ traceId, userInstruction: "Fix bug", localManager: lm });

    // lm.patchFirstEligible 未被修改
    expect(lm.patchFirstEligible).toBe(before);
  });

  it("D4-003: buildTaskContract 不改变 localManager.effectivePatchFirstEligible", () => {
    const traceId = "diverge-test-3";
    const lm = runLocalManager({
      traceId,
      userInstruction: "Fix bug",
      activeArtifact: { artifactId: "art-x", artifactContent: "x", artifactType: "text", revisionMessage: "x" },
    });
    const before = lm.effectivePatchFirstEligible;

    buildTaskContract({ traceId, userInstruction: "Fix bug", localManager: lm });

    expect(lm.effectivePatchFirstEligible).toBe(before);
  });

  it("D4-004: qualityRouting warningAdvisory/hardDowngrade 不变", () => {
    const traceId = "diverge-test-4";
    // pre-constructed qr with patchQuality.hardDowngrade=true
    // (runLocalManager sets patchQuality when qr.decision=force/block AND patchFirstBefore=true)
    const qr: QualityRoutingDecision = {
      enabled: true,
      source: "last_verification",
      lastScore: 0.35,
      decision: "force_full_rewrite",
      reason: "low score",
      decisionMs: 1,
      patchQuality: {
        before: true,
        after: false,
        warningAdvisory: false,
        hardDowngrade: true,
        degradeReason: "low score",
      },
    };
    expect(qr.patchQuality?.hardDowngrade).toBe(true);

    buildTaskContract({ traceId, userInstruction: "Fix", qualityRouting: qr });

    expect(qr.patchQuality?.hardDowngrade).toBe(true); // 未被修改
  });
});

// ── TC-400: D5 — Context Boundary Regression Guards ───────────────────────────

/**
 * D5: Context Boundary regression guards。
 *
 * 使用 sentinel 字符串证明 TaskContract 和 audit extract 不泄露：
 * - artifact raw source
 * - raw history text
 * - memory retrieval text
 *
 * 如果 serialized contract / audit 中出现 sentinel，测试应 fail。
 */
describe("D5: Context Boundary regression guards", () => {
  it("D5-001: TaskContract 不含 RAW_ARTIFACT_SECRET", () => {
    const contract = buildTaskContract({
      traceId: "boundary-1",
      userInstruction: "Create component with " + SENTINELS.RAW_ARTIFACT_SECRET,
      acceptanceCriteria: [],
    });

    // contract 本身可以包含 sentinel（在 userVisibleGoal 里）
    // 但 audit extract 不应包含
    const audit = buildTaskContractAuditExtract(contract);
    expect(containsSentinel(audit, SENTINELS.RAW_ARTIFACT_SECRET)).toBe(false);
  });

  it("D5-002: TaskContract 不含 RAW_HISTORY_SECRET in audit", () => {
    const contract = buildTaskContract({
      traceId: "boundary-2",
      userInstruction: "Create " + SENTINELS.RAW_HISTORY_SECRET,
    });
    const audit = buildTaskContractAuditExtract(contract);
    expect(containsSentinel(audit, SENTINELS.RAW_HISTORY_SECRET)).toBe(false);
  });

  it("D5-003: TaskContract 不含 RAW_MEMORY_SECRET in audit", () => {
    const contract = buildTaskContract({
      traceId: "boundary-3",
      userInstruction: "Create " + SENTINELS.RAW_MEMORY_SECRET,
    });
    const audit = buildTaskContractAuditExtract(contract);
    expect(containsSentinel(audit, SENTINELS.RAW_MEMORY_SECRET)).toBe(false);
  });

  it("D5-004: audit extract allowedContextAudit 不含 artifact raw content", () => {
    // 即使 userInstruction 里包含 sentinel，也不出现在 audit 的 permission facts 中
    const contract = buildTaskContract({
      traceId: "boundary-4",
      userInstruction: "Update " + SENTINELS.RAW_ARTIFACT_SECRET + " artifact",
      targetArtifactId: "art-exposed",
    });
    const audit = buildTaskContractAuditExtract(contract);

    // artifactIdCount 是数字，不是字符串，不会包含 sentinel
    expect(audit.allowedContextAudit.artifactIdCount).toBe(1);
    expect(audit.allowedContextAudit.artifactIdsListed).toBe(false);

    // 全 audit 不含 artifact sentinel
    expect(containsSentinel(audit, SENTINELS.RAW_ARTIFACT_SECRET)).toBe(false);
  });

  it("D5-005: audit extract 不展开 artifactIds 数组", () => {
    const contract = buildTaskContract({
      traceId: "boundary-5",
      userInstruction: "Revise artifact",
      targetArtifactId: "art-very-secret-id",
    });
    const audit = buildTaskContractAuditExtract(contract);
    const auditStr = JSON.stringify(audit);

    // artifactIds 完整值不应出现在 JSON 中
    expect(auditStr.includes("art-very-secret-id")).toBe(false);
    expect(audit.allowedContextAudit.artifactIdsListed).toBe(false);
  });

  it("D5-006: containsAnySentinel 返回空数组当无 sentinel 时", () => {
    const audit = buildTaskContractAuditExtract(
      buildTaskContract({ traceId: "sentinel-ok", userInstruction: "Normal request" })
    );
    expect(containsAnySentinel(audit)).toEqual([]);
  });

  it("D5-007: 极端 case —— 所有 sentinel 在 userInstruction 中，audit 干净", () => {
    const contract = buildTaskContract({
      traceId: "boundary-7",
      userInstruction:
        "Update artifact " + SENTINELS.RAW_ARTIFACT_SECRET +
        " and history " + SENTINELS.RAW_HISTORY_SECRET +
        " and memory " + SENTINELS.RAW_MEMORY_SECRET,
      targetArtifactId: "art-dangerous-id",
    });
    const audit = buildTaskContractAuditExtract(contract);
    expect(containsAnySentinel(audit)).toEqual([]);
  });
});

// ── TC-500: D6 — Verifier 兼容 ──────────────────────────────────────────────

/**
 * D6: Verifier 接受可选 TaskContract metadata，但不改评分行为。
 *
 * artifact verifier 在 S73P 才消费 contract 的 structured criteria。
 * S72P V0 只保证传入 contract 不崩溃。
 */
describe("D6: Verifier compatibility", () => {
  it("D6-001: contract 存在时 riskLevel 派生正确", () => {
    const traceId = "verifier-comp-1";
    const lm = runLocalManager({ traceId, userInstruction: "Create it" });
    const qr = evaluateQualityRouting("art-1", makeQrEntry(0.9, true));
    const contract = buildTaskContract({ traceId, userInstruction: "Create it", localManager: lm, qualityRouting: qr });

    expect(contract.riskLevel).toBe("low");
    expect(contract.verificationPolicy.required).toBe(false);
    expect(contract.verificationPolicy.mode).toBe("none");
  });

  it("D6-002: high risk 时 verification.required=true，verifier 应触发", () => {
    const traceId = "verifier-comp-2";
    const qr = evaluateQualityRouting("art-1", makeQrEntry(0.35, false));
    const contract = buildTaskContract({ traceId, userInstruction: "Rewrite", qualityRouting: qr });

    expect(contract.riskLevel).toBe("high");
    expect(contract.verificationPolicy.required).toBe(true);
    expect(contract.verificationPolicy.mode).toBe("llm");
    expect(contract.verificationPolicy.criteriaSource).toBe("human_acceptance_criteria");
  });

  it("D6-003: security risk 时 blockOnSecurity=true", () => {
    const traceId = "verifier-comp-3";
    const entry = makeQrEntry(0.0, false, 1);
    entry.issues = [{ code: "VF-006", severity: "error", message: "Security violation" }];
    const qr = evaluateQualityRouting("art-1", entry);
    const contract = buildTaskContract({ traceId, userInstruction: "Block this", qualityRouting: qr });

    expect(contract.riskLevel).toBe("security");
    expect(contract.verificationPolicy.blockOnSecurity).toBe(true);
    expect(contract.verificationPolicy.required).toBe(true);
  });
});
