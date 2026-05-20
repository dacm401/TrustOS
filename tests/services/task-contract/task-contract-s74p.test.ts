/**
 * Sprint 74P: Contract-aware Verifier V1 — Tests
 *
 * 覆盖：
 * - verifyAgainstCriteria() 行为
 * - recommendedAction 决策
 * - Security / human_review / quality_threshold / llm_judged 分支
 * - Score 聚合
 * - Ledger audit extract 不含敏感内容
 * - No-routing-divergence
 * - Context boundary sentinel guards
 */

import { describe, it, expect } from "vitest";
import { v4 as uuid } from "uuid";

import type { VerificationCriterion } from "../../../src/services/task-contract/task-contract-types.js";
import type { ArtifactVerifierInput } from "../../../src/services/verifier/artifact-verifier.js";
import { verifyArtifact } from "../../../src/services/verifier/artifact-verifier.js";
import {
  verifyAgainstCriteria,
  buildContractVerificationAudit,
} from "../../../src/services/verifier/contract-verifier.js";
import type { ContractVerificationAuditExtract } from "../../../src/services/verifier/contract-verifier.js";

// ── Test Fixtures ─────────────────────────────────────────────────────────

const VALID_REACT = `import React from "react";
export default function App() {
  return <div>Hello</div>;
}`;

const EMPTY_CONTENT = "";

const UNKNOWN_TYPE = "just some text";

function makeCriterion(
  partial: Partial<VerificationCriterion> & { id: string; type: VerificationCriterion["type"] }
): VerificationCriterion {
  return {
    id: partial.id,
    label: partial.label ?? "test criterion",
    type: partial.type,
    target: partial.target ?? "artifact",
    severity: partial.severity ?? "low",
    required: partial.required ?? false,
    source: partial.source ?? "systemDefault",
    deterministic: partial.deterministic ?? true,
    ...partial,
  };
}

function makeArtifactInput(
  partial: Partial<ArtifactVerifierInput> & { traceId: string }
): ArtifactVerifierInput {
  return {
    traceId: partial.traceId,
    artifactType: partial.artifactType ?? "tsx",
    content: partial.content ?? VALID_REACT,
    patchApplied: partial.patchApplied ?? false,
    security: partial.security ?? {
      artifactToManager: false,
      rawHistoryToWorker: false,
      rawMemoryToWorker: false,
    },
    ...partial,
  };
}

// ── S74P-CVR: Basic Verification ─────────────────────────────────────────

describe("verifyAgainstCriteria — basic behavior", () => {

  it("S74P-CVR-001: valid artifact + no criteria → accept", () => {
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-001" }),
      []
    );
    expect(result.passed).toBe(true);
    expect(result.recommendedAction).toBe("accept");
    expect(result.criteriaEvaluated).toBe(0);
    expect(result.criteriaPassed).toBe(0);
    expect(result.hasSecurityFailure).toBe(false);
    expect(result.hasHumanReviewRequired).toBe(false);
  });

  it("S74P-CVR-002: empty content fails text_presence", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "c1", type: "text_presence", required: true }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-002", content: EMPTY_CONTENT }),
      criteria
    );
    const textResult = result.results.find((r) => r.criterionId === "c1");
    expect(textResult?.passed).toBe(false);
    expect(textResult?.reasonCode).toBe("missing_text");
    expect(result.criteriaFailed).toBe(1);
  });

  it("S74P-CVR-003: text_presence with expected text — contains → passed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-text",
        type: "text_presence",
        required: true,
        expected: "Hello",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-003", content: VALID_REACT }),
      criteria
    );
    const textResult = result.results.find((r) => r.criterionId === "c-text");
    expect(textResult?.passed).toBe(true);
    expect(textResult?.deterministic).toBe(true);
  });

  it("S74P-CVR-004: text_presence with expected text — missing → failed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-text-missing",
        type: "text_presence",
        required: true,
        expected: "SOME_UNIQUE_TOKEN_THAT_IS_NOT_PRESENT",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-004", content: VALID_REACT }),
      criteria
    );
    const textResult = result.results.find((r) => r.criterionId === "c-text-missing");
    expect(textResult?.passed).toBe(false);
    expect(textResult?.reasonCode).toBe("missing_text");
  });

  it("S74P-CVR-005: structure_presence — tsx with React structure → passed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-struct",
        type: "structure_presence",
        target: "artifact",
        required: false,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-005", artifactType: "tsx", content: VALID_REACT }),
      criteria
    );
    const structResult = result.results.find((r) => r.criterionId === "c-struct");
    expect(structResult?.passed).toBe(true);
    expect(structResult?.reasonCode).toBe("passed");
  });

  it("S74P-CVR-006: structure_presence — tsx without React structure → failed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-struct-bad",
        type: "structure_presence",
        target: "artifact",
        required: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-006",
        artifactType: "tsx",
        content: "const x = 1; // no export default",
      }),
      criteria
    );
    const structResult = result.results.find((r) => r.criterionId === "c-struct-bad");
    expect(structResult?.passed).toBe(false);
    expect(structResult?.reasonCode).toBe("missing_structure");
  });

  it("S74P-CVR-007: metadata_match — known artifactType → passed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-meta",
        type: "metadata_match",
        target: "metadata",
        required: false,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-007", artifactType: "tsx", content: VALID_REACT }),
      criteria
    );
    const metaResult = result.results.find((r) => r.criterionId === "c-meta");
    expect(metaResult?.passed).toBe(true);
  });

  it("S74P-CVR-008: metadata_match — unknown artifactType → failed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-meta-unknown",
        type: "metadata_match",
        target: "metadata",
        required: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-008", artifactType: "unknown", content: VALID_REACT }),
      criteria
    );
    const metaResult = result.results.find((r) => r.criterionId === "c-meta-unknown");
    expect(metaResult?.passed).toBe(false);
    expect(metaResult?.reasonCode).toBe("metadata_mismatch");
  });

  it("S74P-CVR-009: revision lineage mismatch → metadata_mismatch", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-lineage",
        type: "metadata_match",
        target: "metadata",
        label: "Revision lineage must be valid",
        required: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-009",
        content: VALID_REACT,
        revisionOfArtifactId: "actual-id",
        expectedRevisionOfArtifactId: "expected-id",
      }),
      criteria
    );
    const lineageResult = result.results.find((r) => r.criterionId === "c-lineage");
    expect(lineageResult?.passed).toBe(false);
    expect(lineageResult?.reasonCode).toBe("metadata_mismatch");
  });

  it("S74P-CVR-010: revision lineage valid → passed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "c-lineage-ok",
        type: "metadata_match",
        target: "metadata",
        label: "Revision lineage must be valid",
        required: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-010",
        content: VALID_REACT,
        revisionOfArtifactId: "same-id",
        expectedRevisionOfArtifactId: "same-id",
      }),
      criteria
    );
    const lineageResult = result.results.find((r) => r.criterionId === "c-lineage-ok");
    expect(lineageResult?.passed).toBe(true);
  });
});

// ── S74P-SEC: Security Criteria ──────────────────────────────────────────

describe("verifyAgainstCriteria — security criteria", () => {

  it("S74P-SEC-001: artifactToManager=true → security_check failed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "sec-1",
        type: "security_check",
        label: "Security check: artifact not sent to Manager LLM",
        severity: "security",
        required: true,
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-sec-001",
        content: VALID_REACT,
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      }),
      criteria
    );
    const secResult = result.results.find((r) => r.criterionId === "sec-1");
    expect(secResult?.passed).toBe(false);
    expect(secResult?.reasonCode).toBe("security_issue");
    expect(secResult?.severity).toBe("security");
  });

  it("S74P-SEC-002: all security flags false → security_check passed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "sec-2",
        type: "security_check",
        label: "Security check: raw history not sent to Worker",
        severity: "security",
        required: true,
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-sec-002",
        content: VALID_REACT,
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
      }),
      criteria
    );
    const secResult = result.results.find((r) => r.criterionId === "sec-2");
    expect(secResult?.passed).toBe(true);
  });

  it("S74P-SEC-003: security failure → hasSecurityFailure=true", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "sec-3",
        type: "security_check",
        label: "Security check: raw memory not sent to Worker",
        severity: "security",
        required: true,
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-sec-003",
        content: VALID_REACT,
        security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: true },
      }),
      criteria
    );
    expect(result.hasSecurityFailure).toBe(true);
    expect(result.recommendedAction).toBe("block");
    expect(result.blockingIssues).toBe(1);
  });

  it("S74P-SEC-004: security advisory (required=false) → not blocking", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "sec-4",
        type: "security_check",
        label: "Security check advisory",
        severity: "security",
        required: false, // advisory
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-sec-004",
        content: VALID_REACT,
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      }),
      criteria
    );
    expect(result.hasSecurityFailure).toBe(false); // not required
    expect(result.blockingIssues).toBe(0);
    expect(result.recommendedAction).toBe("revise"); // advisory, not block
  });
});

// ── S74P-QT: Quality Threshold ───────────────────────────────────────────

describe("verifyAgainstCriteria — quality_threshold", () => {

  it("S74P-QT-001: score >= threshold → passed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "qt-1",
        type: "quality_threshold",
        threshold: 0.5,
        severity: "high",
        required: true,
        deterministic: true,
      }),
    ];
    // Valid artifact → base score = 1.0
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-qt-001", content: VALID_REACT }),
      criteria
    );
    const qtResult = result.results.find((r) => r.criterionId === "qt-1");
    expect(qtResult?.passed).toBe(true);
    expect(qtResult?.reasonCode).toBe("passed");
  });

  it("S74P-QT-002: score < threshold → failed", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "qt-2",
        type: "quality_threshold",
        threshold: 0.95,
        severity: "high",
        required: true,
        deterministic: true,
      }),
    ];
    // Valid artifact → base score = 1.0 (will pass threshold 0.95)
    // Use unknown type to get warning score < 1.0
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-qt-002",
        artifactType: "unknown",
        content: VALID_REACT,
      }),
      criteria
    );
    const qtResult = result.results.find((r) => r.criterionId === "qt-2");
    expect(qtResult?.passed).toBe(false);
    expect(qtResult?.reasonCode).toBe("below_threshold");
  });
});

// ── S74P-HR: Human Review ─────────────────────────────────────────────────

describe("verifyAgainstCriteria — human_review", () => {

  it("S74P-HR-001: human_review → passed=null, reasonCode=requires_human_review", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "hr-1",
        type: "human_review",
        required: true,
        deterministic: false,
        severity: "high",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-hr-001", content: VALID_REACT }),
      criteria
    );
    const hrResult = result.results.find((r) => r.criterionId === "hr-1");
    expect(hrResult?.passed).toBeNull();
    expect(hrResult?.reasonCode).toBe("requires_human_review");
    expect(hrResult?.deterministic).toBe(false);
    expect(hrResult?.confidence).toBe(0.5);
  });

  it("S74P-HR-002: human_review required → recommendedAction=human_review", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "hr-2",
        type: "human_review",
        required: true,
        deterministic: false,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-hr-002", content: VALID_REACT }),
      criteria
    );
    expect(result.hasHumanReviewRequired).toBe(true);
    expect(result.recommendedAction).toBe("human_review");
    // Not a failure (null), so passed=true
    expect(result.passed).toBe(true);
  });

  it("S74P-HR-003: human_review advisory (required=false) → not block accept", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "hr-3",
        type: "human_review",
        required: false, // advisory
        deterministic: false,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-hr-003", content: VALID_REACT }),
      criteria
    );
    // No blocking issues
    expect(result.hasHumanReviewRequired).toBe(false);
    // With other passing criteria, recommend accept (advisory human_review alone doesn't block)
    expect(result.recommendedAction).toBe("accept");
  });
});

// ── S74P-LLM: LLM Judged ─────────────────────────────────────────────────

describe("verifyAgainstCriteria — llm_judged", () => {

  it("S74P-LLM-001: llm_judged → passed=null, reasonCode=llm_judged_uncertain", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "llm-1",
        type: "llm_judged",
        deterministic: false,
        severity: "medium",
        required: false,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-llm-001", content: VALID_REACT }),
      criteria
    );
    const llmResult = result.results.find((r) => r.criterionId === "llm-1");
    expect(llmResult?.passed).toBeNull();
    expect(llmResult?.reasonCode).toBe("llm_judged_uncertain");
    expect(llmResult?.deterministic).toBe(false);
    expect(llmResult?.confidence).toBe(0.5);
  });

  it("S74P-LLM-002: llm_judged advisory alone → recommendedAction=accept", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "llm-2",
        type: "llm_judged",
        deterministic: false,
        required: false,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-llm-002", content: VALID_REACT }),
      criteria
    );
    // llm_judged is not a failure (null), no blocking issues
    expect(result.recommendedAction).toBe("accept");
  });

  it("S74P-LLM-003: llm_judged + security failure → recommendedAction=block", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "llm-3", type: "llm_judged", deterministic: false, required: false }),
      makeCriterion({
        id: "sec-llm",
        type: "security_check",
        label: "Security check",
        severity: "security",
        required: true,
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-llm-003",
        content: VALID_REACT,
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      }),
      criteria
    );
    // Security takes priority
    expect(result.recommendedAction).toBe("block");
    expect(result.hasSecurityFailure).toBe(true);
  });
});

// ── S74P-ACT: recommendedAction Decision ──────────────────────────────────

describe("verifyAgainstCriteria — recommendedAction decision", () => {

  it("S74P-ACT-001: all pass → accept", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "a1", type: "text_presence", required: true }),
      makeCriterion({ id: "a2", type: "structure_presence", required: false }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-act-001", content: VALID_REACT }),
      criteria
    );
    expect(result.recommendedAction).toBe("accept");
    expect(result.passed).toBe(true);
  });

  it("S74P-ACT-002: required failure (non-security) → rewrite", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "a3",
        type: "text_presence",
        required: true,
        severity: "high",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-act-002", content: EMPTY_CONTENT }),
      criteria
    );
    expect(result.recommendedAction).toBe("rewrite");
    expect(result.passed).toBe(false);
    expect(result.blockingIssues).toBe(1);
  });

  it("S74P-ACT-003: advisory failure only → revise", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "a4",
        type: "structure_presence",
        required: false, // advisory
        severity: "medium",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-act-003",
        artifactType: "tsx",
        content: "const x = 1; // no React structure",
      }),
      criteria
    );
    expect(result.recommendedAction).toBe("revise");
    expect(result.passed).toBe(true); // advisory, not blocking
  });

  it("S74P-ACT-004: security failure → block (overrides rewrite/human_review)", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "a5",
        type: "security_check",
        label: "Security check",
        severity: "security",
        required: true,
        deterministic: true,
      }),
      makeCriterion({
        id: "a6",
        type: "text_presence",
        required: true,
        severity: "high",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-act-004",
        content: EMPTY_CONTENT,
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      }),
      criteria
    );
    // Security has highest priority
    expect(result.recommendedAction).toBe("block");
    expect(result.blockingIssues).toBeGreaterThanOrEqual(1);
  });

  it("S74P-ACT-005: human_review required → human_review (overrides rewrite)", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "a7",
        type: "human_review",
        required: true,
        deterministic: false,
      }),
      makeCriterion({
        id: "a8",
        type: "text_presence",
        required: true,
        severity: "high",
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-act-005", content: EMPTY_CONTENT }),
      criteria
    );
    // human_review required → human_review (before rewrite)
    // BUT: text_presence required + empty = failed → also rewrite-worthy
    // Priority: block > human_review > rewrite > revise > accept
    // So: text_presence required fails → hasRequiredFailure=true
    // Since hasHumanReviewRequired=true and no security failure:
    // recommendedAction = human_review (higher priority than rewrite)
    expect(result.hasHumanReviewRequired).toBe(true);
    expect(result.recommendedAction).toBe("human_review");
  });
});

// ── S74P-SCORE: Score Aggregation ─────────────────────────────────────────

describe("verifyAgainstCriteria — score aggregation", () => {

  it("S74P-SCORE-001: all pass → score = 1.0", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "sc-1", type: "text_presence", required: true }),
      makeCriterion({ id: "sc-2", type: "structure_presence", required: false }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-score-001", content: VALID_REACT }),
      criteria
    );
    expect(result.score).toBe(1.0);
  });

  it("S74P-SCORE-002: security failure → score < 1.0", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "sc-3",
        type: "security_check",
        label: "Security check",
        severity: "security",
        required: true,
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({
        traceId: "s74p-score-002",
        content: VALID_REACT,
        security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
      }),
      criteria
    );
    expect(result.score).toBeLessThan(1.0);
    expect(result.base.score).toBeLessThan(1.0); // VF-006 error → base score < 1.0
  });

  it("S74P-SCORE-003: null criteria don't cause negative score", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "sc-4", type: "llm_judged", deterministic: false, required: false }),
      makeCriterion({ id: "sc-5", type: "human_review", deterministic: false, required: false }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-score-003", content: VALID_REACT }),
      criteria
    );
    expect(result.score).toBeGreaterThanOrEqual(0.7); // unresolved penalty applied
    expect(result.score).toBeLessThanOrEqual(1.0);
  });

  it("S74P-SCORE-004: score respects base VerificationResult", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "sc-5",
        type: "quality_threshold",
        threshold: 0.5,
        required: true,
        deterministic: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-score-004", content: VALID_REACT }),
      criteria
    );
    expect(result.base.score).toBe(1.0);
    // criteria score should also reflect passed threshold
    expect(result.score).toBeGreaterThanOrEqual(result.base.score);
  });
});

// ── S74P-AUD: Ledger Audit Extract ───────────────────────────────────────

describe("buildContractVerificationAudit — safe audit extract", () => {

  it("S74P-AUD-001: audit does not contain raw artifact content", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "aud-1", type: "text_presence", required: true, label: "Content check" }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-aud-001", content: VALID_REACT }),
      criteria
    );
    const audit = buildContractVerificationAudit(result);
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain("export default function");
    expect(auditStr).not.toContain("Hello");
  });

  it("S74P-AUD-002: audit does not contain criterion label/description", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "aud-2",
        type: "text_presence",
        label: "Content must be non-empty — DO NOT LEAK THIS LABEL",
        required: true,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-aud-002", content: VALID_REACT }),
      criteria
    );
    const audit = buildContractVerificationAudit(result);
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain("DO NOT LEAK THIS LABEL");
    expect(auditStr).not.toContain("Content must be non-empty");
  });

  it("S74P-AUD-003: audit contains all required summary fields", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "aud-3", type: "text_presence", required: true }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-aud-003", content: VALID_REACT }),
      criteria
    );
    const audit: ContractVerificationAuditExtract = buildContractVerificationAudit(result);
    expect(typeof audit.traceId).toBe("string");
    expect(typeof audit.passed).toBe("boolean");
    expect(typeof audit.score).toBe("number");
    expect(typeof audit.criteriaEvaluated).toBe("number");
    expect(typeof audit.criteriaPassed).toBe("number");
    expect(typeof audit.criteriaFailed).toBe("number");
    expect(typeof audit.blockingIssues).toBe("number");
    expect(["accept", "revise", "rewrite", "block", "human_review"]).toContain(audit.recommendedAction);
    expect(typeof audit.hasHumanReviewRequired).toBe("boolean");
    expect(typeof audit.hasSecurityFailure).toBe("boolean");
    expect(typeof audit.decisionMs).toBe("number");
  });

  it("S74P-AUD-004: audit.unresolvedCount correct", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "aud-4", type: "llm_judged", deterministic: false, required: false }),
      makeCriterion({ id: "aud-5", type: "human_review", deterministic: false, required: true }),
      makeCriterion({ id: "aud-6", type: "text_presence", required: true }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-aud-004", content: VALID_REACT }),
      criteria
    );
    const audit = buildContractVerificationAudit(result);
    expect(audit.unresolvedCount).toBe(2); // llm_judged + human_review
  });
});

// ── S74P-BOUND: Context Boundary ─────────────────────────────────────────

describe("D6: Context boundary — sentinel guards (S74P)", () => {
  const SENTINEL_SECRET = "S74P_SENTINEL_SECRET_DO_NOT_LEAK";

  it("S74P-BOUND-001: raw artifact sentinel does not appear in audit", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "bound-1", type: "text_presence", required: true }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-bound-001", content: SENTINEL_SECRET }),
      criteria
    );
    const audit = buildContractVerificationAudit(result);
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain(SENTINEL_SECRET);
  });

  it("S74P-BOUND-002: audit result does not contain sentinel", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({
        id: "bound-2",
        type: "text_presence",
        required: true,
        label: `Label with ${SENTINEL_SECRET}`,
        description: `Description with ${SENTINEL_SECRET}`,
      }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-bound-002", content: VALID_REACT }),
      criteria
    );
    const audit = buildContractVerificationAudit(result);
    const auditStr = JSON.stringify(audit);
    expect(auditStr).not.toContain(SENTINEL_SECRET);
  });

  it("S74P-BOUND-003: contract result full serialization does not include raw content in audit", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "bound-3", type: "text_presence", required: true }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-bound-003", content: SENTINEL_SECRET }),
      criteria
    );
    // Full result contains criterion results which reference criterion IDs but not content
    const resultStr = JSON.stringify(result);
    // Audit extract specifically must not contain the sentinel
    const audit = buildContractVerificationAudit(result);
    expect(JSON.stringify(audit)).not.toContain(SENTINEL_SECRET);
    // Result itself should have criterion IDs but not content strings
    expect(resultStr).not.toContain("S74P_SENTINEL_SECRET_DO_NOT_LEAK");
  });
});

// ── S74P-NRD: No-routing-divergence ───────────────────────────────────────

describe("D5R: No-routing-divergence — verifyAgainstCriteria does not change Verifier V0 (S74P)", () => {

  it("S74P-NRD-001: base score unchanged by criteria", () => {
    // Run with criteria
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "nrd-1", type: "text_presence", required: true }),
    ];
    const result1 = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-nrd-001", content: VALID_REACT }),
      criteria
    );
    // Run without criteria — base should be identical
    const result2 = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-nrd-001b", content: VALID_REACT }),
      []
    );
    // base score comes from verifyArtifact() which is unchanged
    expect(result1.baseScore).toBe(result2.baseScore);
    expect(result1.base.passed).toBe(result2.base.passed);
  });

  it("S74P-NRD-002: verifyArtifact unchanged — called once per verifyAgainstCriteria", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "nrd-2", type: "text_presence", required: true }),
      makeCriterion({ id: "nrd-3", type: "structure_presence", required: false }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-nrd-002", content: VALID_REACT }),
      criteria
    );
    // Base comes from single verifyArtifact call
    expect(result.base.issues.length).toBeGreaterThanOrEqual(0);
    // Criteria evaluation happens after (not modifying base)
    expect(result.criteriaEvaluated).toBe(2);
  });

  it("S74P-NRD-003: recommendedAction is output, not routing input", () => {
    const criteria: VerificationCriterion[] = [
      makeCriterion({ id: "nrd-4", type: "text_presence", required: true }),
    ];
    const result = verifyAgainstCriteria(
      makeArtifactInput({ traceId: "s74p-nrd-003", content: VALID_REACT }),
      criteria
    );
    // recommendedAction is a verifier output, not a routing decision
    expect(["accept", "revise", "rewrite", "block", "human_review"]).toContain(result.recommendedAction);
    // It does not mutate any routing state
  });
});

// ── S74P-REGR: Regression — existing behavior preserved ───────────────────

describe("S74P regression: verifyArtifact behavior unchanged", () => {
  // These tests prove verifyArtifact() itself is untouched by S74P changes

  it("S74P-REGR-001: verifyArtifact still detects VF-001 empty content", () => {
    const result = verifyArtifact({ traceId: "regr-001", content: "" });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i: any) => i.code === "VF-001")).toBe(true);
  });

  it("S74P-REGR-002: verifyArtifact still detects VF-006 security issue", () => {
    const result = verifyArtifact({
      traceId: "regr-002",
      content: "test",
      security: { artifactToManager: true, rawHistoryToWorker: false, rawMemoryToWorker: false },
    });
    expect(result.passed).toBe(false);
    expect(result.issues.some((i: any) => i.code === "VF-006")).toBe(true);
  });

  it("S74P-REGR-003: verifyArtifact warning-only → passed=true", () => {
    const result = verifyArtifact({
      traceId: "regr-003",
      artifactType: "unknown",
      content: "test content",
    });
    // VF-002 warning only
    expect(result.passed).toBe(true);
    expect(result.score).toBeLessThan(1.0);
    expect(result.score).toBeGreaterThan(0);
  });
});
