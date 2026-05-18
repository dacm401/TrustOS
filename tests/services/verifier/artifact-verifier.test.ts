/**
 * Sprint 65P: Artifact Verifier V0 — 单测
 *
 * 覆盖范围：
 *   VF-01  valid React artifact passes
 *   VF-02  empty content fails (VF-001 error)
 *   VF-03  unknown artifact type → warning (VF-002)
 *   VF-04  missing React structure → warning (VF-003)
 *   VF-05  revision lineage valid passes
 *   VF-06  revision lineage mismatch fails (VF-004 error)
 *   VF-07  artifactToManager=true fails (VF-006 error)
 *   VF-08  rawHistoryToWorker=true fails (VF-007 error)
 *   VF-09  rawMemoryToWorker=true fails (VF-008 error)
 *   VF-10  patchApplied=true with empty content fails (VF-005 error)
 *   VF-11  score degrades on warning (VF-002 warning → score=0.9)
 *   VF-12  multiple errors stack (score capped at 0.0)
 *   VF-13  verifierVersion always "v0"
 *   VF-14  passed=true when only warnings
 *
 * Sprint 65P Patch-path 扩展：
 *   VF-15  patchApplied=true → targetType="patch"
 *   VF-16  patchApplied=false → targetType="artifact"
 *   VF-17  patchApplied=true + content non-empty → passed=true
 *   VF-18  patchApplied=true + lineage valid → checks.lineageValid=true
 *   VF-19  patchApplied=true + lineage mismatch → VF-004 error
 */

import { describe, it, expect } from "vitest";
import { verifyArtifact, verificationToLedgerEntry } from "../../../src/services/verifier/artifact-verifier.js";

const VALID_REACT = `
import React from "react";
export default function LoginPage() {
  return (
    <div>
      <h1>Login</h1>
    </div>
  );
}
`.trim();

const VALID_TSX_MINIMAL = `export default function App() { return <div>Hello</div>; }`;

describe("Artifact Verifier V0", () => {

  // VF-01: valid React artifact passes
  it("VF-01 valid React artifact passes", () => {
    const result = verifyArtifact({
      traceId: "test-vf-01",
      artifactType: "tsx",
      content: VALID_REACT,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(0.8);
    expect(result.checks.nonEmpty).toBe(true);
    expect(result.checks.artifactTypeKnown).toBe(true);
    expect(result.checks.reactStructurePresent).toBe(true);
    expect(result.issues.filter(i => i.severity === "error")).toHaveLength(0);
  });

  // VF-02: empty content fails
  it("VF-02 empty content fails (VF-001 error)", () => {
    const result = verifyArtifact({
      traceId: "test-vf-02",
      artifactType: "tsx",
      content: "",
    });
    expect(result.passed).toBe(false);
    expect(result.checks.nonEmpty).toBe(false);
    const err = result.issues.find(i => i.code === "VF-001");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  // VF-03: unknown artifact type → warning
  it("VF-03 unknown artifact type → VF-002 warning (not error)", () => {
    const result = verifyArtifact({
      traceId: "test-vf-03",
      artifactType: "unknown",
      content: VALID_REACT,
    });
    // unknown type is a warning, not an error — should still pass
    expect(result.passed).toBe(true);
    expect(result.checks.artifactTypeKnown).toBe(false);
    const warn = result.issues.find(i => i.code === "VF-002");
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warning");
  });

  // VF-04: missing React structure → warning
  it("VF-04 missing React structure → VF-003 warning", () => {
    const plainText = "just some text without any React structure";
    const result = verifyArtifact({
      traceId: "test-vf-04",
      artifactType: "tsx",
      content: plainText,
    });
    // Missing React structure is a warning
    expect(result.passed).toBe(true);
    expect(result.checks.reactStructurePresent).toBe(false);
    const warn = result.issues.find(i => i.code === "VF-003");
    expect(warn).toBeDefined();
    expect(warn?.severity).toBe("warning");
  });

  // VF-05: revision lineage valid passes
  it("VF-05 revision lineage valid passes", () => {
    const artifactId = "artifact-abc-123";
    const result = verifyArtifact({
      traceId: "test-vf-05",
      artifactType: "tsx",
      content: VALID_REACT,
      revisionOfArtifactId: artifactId,
      expectedRevisionOfArtifactId: artifactId,
    });
    expect(result.passed).toBe(true);
    expect(result.checks.lineageValid).toBe(true);
    expect(result.issues.find(i => i.code === "VF-004")).toBeUndefined();
  });

  // VF-06: revision lineage mismatch fails
  it("VF-06 revision lineage mismatch fails (VF-004 error)", () => {
    const result = verifyArtifact({
      traceId: "test-vf-06",
      artifactType: "tsx",
      content: VALID_REACT,
      revisionOfArtifactId: "artifact-actual-xyz",
      expectedRevisionOfArtifactId: "artifact-expected-abc",
    });
    expect(result.passed).toBe(false);
    expect(result.checks.lineageValid).toBe(false);
    const err = result.issues.find(i => i.code === "VF-004");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  // VF-07: artifactToManager=true → VF-006 error
  it("VF-07 artifactToManager=true → VF-006 error", () => {
    const result = verifyArtifact({
      traceId: "test-vf-07",
      artifactType: "tsx",
      content: VALID_REACT,
      security: { artifactToManager: true },
    });
    expect(result.passed).toBe(false);
    expect(result.checks.securityArtifactNotToManager).toBe(false);
    const err = result.issues.find(i => i.code === "VF-006");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  // VF-08: rawHistoryToWorker=true → VF-007 error
  it("VF-08 rawHistoryToWorker=true → VF-007 error", () => {
    const result = verifyArtifact({
      traceId: "test-vf-08",
      artifactType: "tsx",
      content: VALID_REACT,
      security: { rawHistoryToWorker: true },
    });
    expect(result.passed).toBe(false);
    expect(result.checks.securityHistoryNotToWorker).toBe(false);
    const err = result.issues.find(i => i.code === "VF-007");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  // VF-09: rawMemoryToWorker=true → VF-008 error
  it("VF-09 rawMemoryToWorker=true → VF-008 error", () => {
    const result = verifyArtifact({
      traceId: "test-vf-09",
      artifactType: "tsx",
      content: VALID_REACT,
      security: { rawMemoryToWorker: true },
    });
    expect(result.passed).toBe(false);
    expect(result.checks.securityMemoryNotToWorker).toBe(false);
    const err = result.issues.find(i => i.code === "VF-008");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

  // VF-10: patchApplied=true with empty content fails
  it("VF-10 patchApplied=true with empty content → VF-005 error", () => {
    const result = verifyArtifact({
      traceId: "test-vf-10",
      artifactType: "tsx",
      content: "",
      patchApplied: true,
    });
    expect(result.passed).toBe(false);
    const err = result.issues.find(i => i.code === "VF-001");
    expect(err).toBeDefined(); // empty content is VF-001
    // VF-005 also fires for patchApplied + empty
    const patchErr = result.issues.find(i => i.code === "VF-005");
    expect(patchErr).toBeDefined();
    expect(patchErr?.severity).toBe("error");
  });

  // VF-11: score degrades on warning
  it("VF-11 score degrades on warning (VF-002 → score < 1.0)", () => {
    const result = verifyArtifact({
      traceId: "test-vf-11",
      artifactType: "unknown",
      content: VALID_REACT,
    });
    expect(result.passed).toBe(true);
    expect(result.score).toBeLessThan(1.0);
    expect(result.score).toBeGreaterThan(0.0);
  });

  // VF-12: multiple errors stack, score capped at 0
  it("VF-12 multiple errors stack (score >= 0.0)", () => {
    const result = verifyArtifact({
      traceId: "test-vf-12",
      artifactType: "tsx",
      content: "",
      security: {
        artifactToManager: true,
        rawHistoryToWorker: true,
        rawMemoryToWorker: true,
      },
      patchApplied: true,
    });
    expect(result.passed).toBe(false);
    expect(result.score).toBeGreaterThanOrEqual(0.0);
    expect(result.issues.filter(i => i.severity === "error").length).toBeGreaterThanOrEqual(3);
  });

  // VF-13: verifierVersion always "v0"
  it("VF-13 verifierVersion is always v0", () => {
    const result = verifyArtifact({
      traceId: "test-vf-13",
      content: VALID_REACT,
      artifactType: "tsx",
    });
    expect(result.verifierVersion).toBe("v0");
  });

  // VF-14: passed=true when only warnings
  it("VF-14 passed=true when only warnings", () => {
    const result = verifyArtifact({
      traceId: "test-vf-14",
      // tsx without obvious React structure → VF-003 warning only
      artifactType: "tsx",
      content: "// some minimal tsx file\nconst x = 1;",
    });
    // VF-003 warning only
    expect(result.issues.every(i => i.severity !== "error")).toBe(true);
    expect(result.passed).toBe(true);
  });

  // Ledger entry builder
  it("verificationToLedgerEntry produces correct counts", () => {
    const result = verifyArtifact({
      traceId: "test-ledger",
      artifactType: "tsx",
      content: "",
      security: { artifactToManager: true },
    });
    const entry = verificationToLedgerEntry(result);
    expect(entry.enabled).toBe(true);
    expect(entry.errorCount).toBeGreaterThanOrEqual(1);
    expect(entry.issueCount).toBe(result.issues.length);
    expect(entry.passed).toBe(false);
    expect(entry.verifierVersion).toBe("v0");
  });

  // TSX minimal structure
  it("minimal export default function passes VF-003", () => {
    const result = verifyArtifact({
      traceId: "test-minimal",
      artifactType: "tsx",
      content: VALID_TSX_MINIMAL,
    });
    expect(result.checks.reactStructurePresent).toBe(true);
    expect(result.issues.find(i => i.code === "VF-003")).toBeUndefined();
  });

  // security=all-safe passes
  it("all security flags false → security checks all pass", () => {
    const result = verifyArtifact({
      traceId: "test-security-safe",
      artifactType: "tsx",
      content: VALID_REACT,
      security: {
        artifactToManager: false,
        rawHistoryToWorker: false,
        rawMemoryToWorker: false,
      },
    });
    expect(result.checks.securityArtifactNotToManager).toBe(true);
    expect(result.checks.securityHistoryNotToWorker).toBe(true);
    expect(result.checks.securityMemoryNotToWorker).toBe(true);
    expect(result.issues.filter(i => ["VF-006", "VF-007", "VF-008"].includes(i.code))).toHaveLength(0);
  });

  // null revisionOfArtifactId with non-null expected → warning
  it("null actual revisionId with non-null expected → VF-004 warning", () => {
    const result = verifyArtifact({
      traceId: "test-lineage-missing",
      artifactType: "tsx",
      content: VALID_REACT,
      revisionOfArtifactId: null,
      expectedRevisionOfArtifactId: "expected-abc-123",
    });
    const issue = result.issues.find(i => i.code === "VF-004");
    expect(issue).toBeDefined();
    expect(issue?.severity).toBe("warning");
    // Warning only → passed
    expect(result.passed).toBe(true);
  });

  // ── Sprint 65P Patch-path 扩展 ─────────────────────────────────────────────────

  // VF-15: patchApplied=true → targetType="patch"
  it("VF-15 patchApplied=true → targetType is 'patch'", () => {
    const result = verifyArtifact({
      traceId: "test-vf-15",
      artifactType: "tsx",
      content: VALID_REACT,
      patchApplied: true,
    });
    expect(result.targetType).toBe("patch");
    expect(result.enabled).toBe(true);
  });

  // VF-16: patchApplied=false/undefined → targetType="artifact"
  it("VF-16 patchApplied=false → targetType is 'artifact'", () => {
    const result = verifyArtifact({
      traceId: "test-vf-16",
      artifactType: "tsx",
      content: VALID_REACT,
      patchApplied: false,
    });
    expect(result.targetType).toBe("artifact");

    // Also test undefined (default)
    const result2 = verifyArtifact({
      traceId: "test-vf-16b",
      artifactType: "tsx",
      content: VALID_REACT,
    });
    expect(result2.targetType).toBe("artifact");
  });

  // VF-17: patchApplied=true + content non-empty → passed=true
  it("VF-17 patchApplied=true + non-empty content → passed=true", () => {
    const result = verifyArtifact({
      traceId: "test-vf-17",
      artifactType: "tsx",
      content: VALID_REACT,
      patchApplied: true,
    });
    expect(result.passed).toBe(true);
    expect(result.checks.patchContentValid).toBe(true);
    expect(result.checks.nonEmpty).toBe(true);
  });

  // VF-18: patchApplied=true + lineage valid → checks.lineageValid=true
  it("VF-18 patchApplied=true + valid lineage → lineageValid=true", () => {
    const artifactId = "artifact-patch-source-123";
    const result = verifyArtifact({
      traceId: "test-vf-18",
      artifactType: "tsx",
      content: VALID_REACT,
      patchApplied: true,
      revisionOfArtifactId: artifactId,
      expectedRevisionOfArtifactId: artifactId,
    });
    expect(result.passed).toBe(true);
    expect(result.checks.lineageValid).toBe(true);
    expect(result.issues.find(i => i.code === "VF-004")).toBeUndefined();
  });

  // VF-19: patchApplied=true + lineage mismatch → VF-004 error
  it("VF-19 patchApplied=true + lineage mismatch → VF-004 error", () => {
    const result = verifyArtifact({
      traceId: "test-vf-19",
      artifactType: "tsx",
      content: VALID_REACT,
      patchApplied: true,
      revisionOfArtifactId: "actual-artifact-id",
      expectedRevisionOfArtifactId: "expected-artifact-id",
    });
    expect(result.passed).toBe(false);
    expect(result.checks.lineageValid).toBe(false);
    const err = result.issues.find(i => i.code === "VF-004");
    expect(err).toBeDefined();
    expect(err?.severity).toBe("error");
  });

});
