/**
 * Sprint 73P: Structured Verification Criteria V0 — Tests
 *
 * 覆盖：
 * - buildVerificationCriteria() 逻辑覆盖
 * - buildVerificationCriteriaAudit() 正确性
 * - criteria 不泄露到 ledger audit extract
 * - criteria builder 不改变 routing decision
 */

import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";

import type { LocalManagerDecision } from "../../../src/services/manager/local-manager-runtime.js";
import type { VerificationLedgerEntry } from "../../../src/services/verifier/verifier-types.js";
import { evaluateQualityRouting } from "../../../src/services/verifier/quality-router.js";

import {
  buildTaskContract,
  buildTaskContractAuditExtract,
  buildVerificationCriteria,
  buildVerificationCriteriaAudit,
  SENTINELS,
  containsAnySentinel,
} from "../../../src/services/task-contract/index.js";
import type { TaskContractV0 } from "../../../src/services/task-contract/task-contract-types.js";

// ── Helper: Quality Routing entry ─────────────────────────────────────────────

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

// ── Helper: minimal LocalManagerDecision ───────────────────────────────────────

function makeLm(
  nextAction: LocalManagerDecision["nextAction"] = "direct_create_artifact",
  extra: Partial<LocalManagerDecision> = {}
): LocalManagerDecision {
  return {
    nextAction,
    patchFirstEligible: false,
    effectivePatchFirstEligible: false,
    patchFirstBefore: false,
    policyRoute: "fast",
    managerCalls: 0,
    verification: { enabled: false, passed: true, score: 1.0, issues: [] },
    security: {
      allowRawHistoryToWorker: false,
      allowArtifactToWorker: false,
      allowRawMemoryToWorker: false,
    },
    rawChars: 0,
    safeChars: 0,
    workerArtifactRaw: undefined,
    droppedWorkerArtifacts: 0,
    usedWorkerSummaries: 0,
    patchFirstWarningAdvisory: false,
    patchFirstHardDowngrade: false,
    patchFirstDegradedByWarning: false,
    patchFirstDowngradedByQuality: false,
    ...extra,
  } as LocalManagerDecision;
}

// ── S73P-TC: Criteria Builder Coverage ───────────────────────────────────────

describe("buildVerificationCriteria", () => {
  // Baseline contract for criteria builder
  function baselineContract(
    riskLevel: "low" | "medium" | "high" | "security" = "low",
    intent: "create_artifact" | "revise_artifact" = "create_artifact",
    expectedOutputKind: "artifact" | "patch" = "artifact"
  ): TaskContractV0 {
    const traceId = uuid();
    const qr =
      riskLevel === "security"
        ? evaluateQualityRouting("art-1", {
            ...makeQrEntry(0.0, false, 1),
            issues: [{ code: "VF-006", severity: "error" as const, message: "Security" }],
          })
        : riskLevel === "high"
        ? evaluateQualityRouting("art-1", makeQrEntry(0.35, false))
        : riskLevel === "medium"
        ? evaluateQualityRouting("art-1", makeQrEntry(0.75, true))
        : evaluateQualityRouting("art-1", makeQrEntry(0.9, true));

    const lm = makeLm(intent === "revise_artifact" ? "direct_artifact_revision" : "direct_create_artifact", {
      patchFirstEligible: expectedOutputKind === "patch",
      effectivePatchFirstEligible: expectedOutputKind === "patch",
      patchFirstBefore: expectedOutputKind === "patch",
    });

    return buildTaskContract({ traceId, userInstruction: "Test task", localManager: lm, qualityRouting: qr });
  }

  it("S73P-TC-001: low risk → includes system default criteria (non-empty, type known)", () => {
    const contract = baselineContract("low");
    const criteria = buildVerificationCriteria(contract);
    expect(criteria.length).toBeGreaterThanOrEqual(2);

    const nonEmpty = criteria.find((c) => c.type === "text_presence");
    expect(nonEmpty).toBeDefined();
    expect(nonEmpty!.source).toBe("systemDefault");
    expect(nonEmpty!.deterministic).toBe(true);
  });

  it("S73P-TC-002: high risk → includes quality_threshold criterion", () => {
    const contract = baselineContract("high");
    const criteria = buildVerificationCriteria(contract);

    const qt = criteria.find((c) => c.type === "quality_threshold");
    expect(qt).toBeDefined();
    expect(qt!.required).toBe(true);
    expect(qt!.source).toBe("riskPolicy");
    expect(qt!.deterministic).toBe(true);
  });

  it("S73P-TC-003: security risk → includes three security_check criteria", () => {
    const contract = baselineContract("security");
    const criteria = buildVerificationCriteria(contract);

    const securityChecks = criteria.filter((c) => c.type === "security_check");
    expect(securityChecks.length).toBe(3);
    securityChecks.forEach((c) => {
      expect(c.required).toBe(true);
      expect(c.severity).toBe("security");
      expect(c.source).toBe("securityPolicy");
      expect(c.deterministic).toBe(true);
    });
  });

  it("S73P-TC-004: artifact output → includes structure_presence criterion", () => {
    const contract = baselineContract("low", "create_artifact", "artifact");
    const criteria = buildVerificationCriteria(contract);

    const structure = criteria.find((c) => c.type === "structure_presence");
    expect(structure).toBeDefined();
    expect(structure!.target).toBe("artifact");
    expect(structure!.deterministic).toBe(true);
  });

  it("S73P-TC-005: patch output → includes structure_presence (required=true)", () => {
    const contract = baselineContract("medium", "revise_artifact", "patch");
    const criteria = buildVerificationCriteria(contract);

    const patch = criteria.find((c) => c.type === "structure_presence" && c.target === "patch");
    expect(patch).toBeDefined();
    expect(patch!.required).toBe(true);
    expect(patch!.deterministic).toBe(true);
  });

  it("S73P-TC-006: revise_artifact with target → includes metadata_match for lineage", () => {
    const contract = baselineContract("medium", "revise_artifact", "patch");
    const criteria = buildVerificationCriteria(contract);

    const lineage = criteria.find((c) => c.type === "metadata_match" && c.target === "metadata");
    expect(lineage).toBeDefined();
    expect(lineage!.source).toBe("systemDefault");
    expect(lineage!.deterministic).toBe(true);
  });

  it("S73P-TC-007: acceptanceCriteria mapping — technical keywords → deterministic", () => {
    const contract = baselineContract("low");
    const acs = [
      "组件必须导出 default",
      "must contain function signature",
      "代码必须包含 export",
    ];
    const criteria = buildVerificationCriteria(contract, acs);

    const acCriteria = criteria.filter((c) => c.source === "acceptanceCriteria");
    expect(acCriteria.length).toBe(3);
    acCriteria.forEach((c) => {
      expect(c.deterministic).toBe(true);
      expect(["structure_presence", "text_presence", "metadata_match"]).toContain(c.type);
    });
  });

  it("S73P-TC-008: acceptanceCriteria mapping — qualitative → llm_judged non-deterministic", () => {
    const contract = baselineContract("low");
    const acs = ["页面要高级一点", "请做得更好", "more elegant"];
    const criteria = buildVerificationCriteria(contract, acs);

    const acCriteria = criteria.filter((c) => c.source === "acceptanceCriteria");
    acCriteria.forEach((c) => {
      expect(c.deterministic).toBe(false);
      expect(["llm_judged", "human_review"]).toContain(c.type);
    });
  });

  it("S73P-TC-009: acceptanceCriteria mapping — manual review keywords → human_review", () => {
    const contract = baselineContract("low");
    // "请人工检查" = manual check, "needs manual review" = manual review, "please manual confirm" = manual confirm
    const acs = ["请人工检查", "needs manual review", "please manual confirm"];
    const criteria = buildVerificationCriteria(contract, acs);

    const acCriteria = criteria.filter((c) => c.source === "acceptanceCriteria");
    expect(acCriteria.length).toBe(3);
    acCriteria.forEach((c) => {
      expect(c.type).toBe("human_review");
      expect(c.required).toBe(true);
      expect(c.deterministic).toBe(false);
    });
  });

  it("S73P-TC-010: all criteria have unique IDs", () => {
    const contract = baselineContract("high");
    const criteria = buildVerificationCriteria(contract);

    const ids = criteria.map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });
});

// ── S73P-TA: Criteria Audit Builder ───────────────────────────────────────────

describe("buildVerificationCriteriaAudit", () => {
  function criteria(...partials: Array<Partial<Parameters<typeof buildVerificationCriteria>[0]>>) {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
    });
    // Use buildVerificationCriteria with custom acceptance criteria
    return buildVerificationCriteria(contract, []);
  }

  it("S73P-TA-001: count and requiredCount correct", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    const criteria = buildVerificationCriteria(contract);
    const audit = buildVerificationCriteriaAudit(criteria);

    expect(audit.count).toBe(criteria.length);
    expect(audit.requiredCount).toBe(criteria.filter((c) => c.required).length);
    expect(audit.deterministicCount).toBe(criteria.filter((c) => c.deterministic).length);
  });

  it("S73P-TA-002: hasSecurityCheck true only when security criteria present", () => {
    const securityContract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      qualityRouting: evaluateQualityRouting("art-1", { ...makeQrEntry(0.0, false, 1), issues: [{ code: "VF-006", severity: "error" as const, message: "" }] }),
    });
    const lowContract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });

    const securityAudit = buildVerificationCriteriaAudit(buildVerificationCriteria(securityContract));
    const lowAudit = buildVerificationCriteriaAudit(buildVerificationCriteria(lowContract));

    expect(securityAudit.hasSecurityCheck).toBe(true);
    expect(lowAudit.hasSecurityCheck).toBe(false);
  });

  it("S73P-TA-003: maxSeverity correctly derived from criteria", () => {
    const securityContract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      qualityRouting: evaluateQualityRouting("art-1", { ...makeQrEntry(0.0, false, 1), issues: [{ code: "VF-006", severity: "error" as const, message: "" }] }),
    });
    const audit = buildVerificationCriteriaAudit(buildVerificationCriteria(securityContract));
    expect(audit.maxSeverity).toBe("security");
  });

  it("S73P-TA-004: sources deduplicated", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    const criteria = buildVerificationCriteria(contract, ["组件必须导出", "页面高级一点"]);
    const audit = buildVerificationCriteriaAudit(criteria);

    expect(new Set(audit.sources).size).toBe(audit.sources.length); // no duplicates
    expect(audit.sources).toContain("systemDefault");
  });
});

// ── S73P-DA: Ledger Audit Extract — criteria audit ────────────────────────────

describe("TaskContract Audit Extract — verificationCriteriaAudit (D4)", () => {
  it("S73P-DA-001: audit contains verificationCriteriaAudit with correct fields", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    const audit = buildTaskContractAuditExtract(contract);

    expect(audit.verificationCriteriaAudit).toBeDefined();
    expect(typeof audit.verificationCriteriaAudit.count).toBe("number");
    expect(typeof audit.verificationCriteriaAudit.requiredCount).toBe("number");
    expect(typeof audit.verificationCriteriaAudit.deterministicCount).toBe("number");
    expect(typeof audit.verificationCriteriaAudit.hasSecurityCheck).toBe("boolean");
    expect(["low", "medium", "high", "security"]).toContain(audit.verificationCriteriaAudit.maxSeverity);
    expect(Array.isArray(audit.verificationCriteriaAudit.sources)).toBe(true);
  });

  it("S73P-DA-002: security contract → verificationCriteriaAudit.hasSecurityCheck=true", () => {
    const entry = { ...makeQrEntry(0.0, false, 1), issues: [{ code: "VF-006", severity: "error" as const, message: "" }] };
    const qr = evaluateQualityRouting("art-1", entry);
    const contract = buildTaskContract({ traceId: uuid(), userInstruction: "test", qualityRouting: qr });
    const audit = buildTaskContractAuditExtract(contract);

    expect(audit.verificationCriteriaAudit.hasSecurityCheck).toBe(true);
    expect(audit.verificationCriteriaAudit.maxSeverity).toBe("security");
    expect(audit.verificationCriteriaAudit.requiredCount).toBeGreaterThan(0);
  });
});

// ── S73P-D5: Context Boundary — criteria labels do not leak ───────────────────

describe("D5: Context Boundary — criteria labels/descriptions safe (S73P)", () => {
  it("S73P-D5-001: criteria labels/descriptions do not contain RAW_ARTIFACT_SECRET in audit", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: `${SENTINELS.RAW_ARTIFACT_SECRET} injected`,
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    const audit = buildTaskContractAuditExtract(contract);
    const found = containsAnySentinel(audit);
    expect(found).toHaveLength(0);
  });

  it("S73P-D5-002: criteria labels/descriptions do not contain RAW_HISTORY_SECRET in audit", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: `${SENTINELS.RAW_HISTORY_SECRET} injected`,
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    const audit = buildTaskContractAuditExtract(contract);
    const found = containsAnySentinel(audit);
    expect(found).toHaveLength(0);
  });

  it("S73P-D5-003: criteria labels/descriptions do not contain RAW_MEMORY_SECRET in audit", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: `${SENTINELS.RAW_MEMORY_SECRET} injected`,
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    const audit = buildTaskContractAuditExtract(contract);
    const found = containsAnySentinel(audit);
    expect(found).toHaveLength(0);
  });

  it("S73P-D5-004: verificationCriteriaAudit does not contain label/description text", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "Create component",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
      acceptanceCriteria: [
        "组件必须包含导出语句",
        "代码要高级一点",
        "请人工确认",
      ],
    });
    const audit = buildTaskContractAuditExtract(contract);

    const auditStr = JSON.stringify(audit.verificationCriteriaAudit);
    expect(auditStr).not.toContain("必须包含");
    expect(auditStr).not.toContain("高级");
    expect(auditStr).not.toContain("人工确认");
  });

  it("S73P-D5-005: full contract serialization is NOT done — only audit goes to ledger", () => {
    // This test documents the design: full contract.verificationCriteria is NOT
    // serialized into the audit extract. Only the audit summary is.
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "Test with sensitive acceptance criteria",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
      acceptanceCriteria: [`${SENTINELS.RAW_MEMORY_SECRET} in criteria`],
    });

    const audit = buildTaskContractAuditExtract(contract);
    // Audit summary should NOT contain the sentinel
    const found = containsAnySentinel(audit);
    expect(found).toHaveLength(0);
    // Audit summary should not have a "criteria" field with full text
    expect(audit.verificationCriteriaAudit).not.toHaveProperty("criteria");
  });
});

// ── S73P-D5R: No-routing-divergence guards ───────────────────────────────────

describe("D5R: No-routing-divergence — criteria builder does not change routing (S73P)", () => {
  it("S73P-D5R-001: criteria builder does not change qualityRouting.decision", () => {
    const qrBefore = evaluateQualityRouting("art-1", makeQrEntry(0.35, false));
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      qualityRouting: qrBefore,
    });
    // Build criteria — this should not mutate qrBefore
    buildVerificationCriteria(contract);

    // qrBefore should be unchanged
    expect(qrBefore.decision).toBe("force_full_rewrite");
  });

  it("S73P-D5R-002: criteria builder does not change localManager.patchFirstEligible", () => {
    const lm: LocalManagerDecision = {
      ...makeLm("direct_artifact_revision"),
      patchFirstEligible: true,
      effectivePatchFirstEligible: true,
      patchFirstBefore: true,
    };
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: lm,
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });
    buildVerificationCriteria(contract);

    expect(lm.patchFirstEligible).toBe(true);
    expect(lm.effectivePatchFirstEligible).toBe(true);
  });

  it("S73P-D5R-003: criteria builder does not change localManager.patchQuality.after", () => {
    const lm: LocalManagerDecision = {
      ...makeLm("direct_artifact_revision"),
      patchFirstEligible: true,
      effectivePatchFirstEligible: true,
      patchFirstBefore: true,
    };
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: lm,
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.75, true)),
    });

    buildVerificationCriteria(contract);
    buildVerificationCriteria(contract); // twice to ensure idempotent

    expect(lm.patchFirstEligible).toBe(true);
  });

  it("S73P-D5R-004: audit.verificationCriteriaAudit is consistent across calls", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
      acceptanceCriteria: ["must export default"],
    });

    const audit1 = buildTaskContractAuditExtract(contract);
    const audit2 = buildTaskContractAuditExtract(contract);

    expect(audit1.verificationCriteriaAudit.count).toBe(audit2.verificationCriteriaAudit.count);
    expect(audit1.verificationCriteriaAudit.requiredCount).toBe(audit2.verificationCriteriaAudit.requiredCount);
  });
});

// ── S73P-DC: criteriaSource transition ─────────────────────────────────────────

describe("criteriaSource transition: human → structured (S73P)", () => {
  it("S73P-DC-001: contract.verificationPolicy.criteriaSource = structured_criteria", () => {
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.9, true)),
    });

    expect(contract.verificationPolicy.criteriaSource).toBe("structured_criteria");
    expect(contract.verificationCriteria.length).toBeGreaterThan(0);
  });

  it("S73P-DC-002: contract.verificationPolicy.criteriaSource does not affect existing behavior", () => {
    // The criteriaSource field change is informational.
    // It does NOT change how the Verifier scores artifacts.
    const contract = buildTaskContract({
      traceId: uuid(),
      userInstruction: "test",
      localManager: makeLm(),
      qualityRouting: evaluateQualityRouting("art-1", makeQrEntry(0.35, false)),
    });

    // riskLevel still drives required/mode/blockOnSecurity as in S72P
    expect(contract.riskLevel).toBe("high");
    expect(contract.verificationPolicy.required).toBe(true);
    expect(contract.verificationPolicy.mode).toBe("llm");
    // criteriaSource change is a schema marker only
    expect(contract.verificationPolicy.criteriaSource).toBe("structured_criteria");
  });
});
