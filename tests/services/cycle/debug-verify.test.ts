/**
 * Debug script: 直接测试 verifyAgainstCriteria 对 advisory criteria 的行为
 */
import { describe, it, expect } from "vitest";
import { verifyAgainstCriteria } from "../../../src/services/verifier/contract-verifier.js";

describe("DEBUG: verifyAgainstCriteria advisory criteria", () => {
  it("advisory text_presence: required=false, expected=MAGIC, content without MAGIC", () => {
    const criteria = [{
      id: 'debug-1',
      label: 'Advisory check',
      type: "text_presence" as const,
      target: "artifact" as const,
      severity: "medium" as const,
      required: false,
      expected: "MAGIC",
      source: "systemDefault" as const,
      deterministic: true,
    }];
    
    const result = verifyAgainstCriteria({
      traceId: "debug",
      artifactType: "text",
      content: "Content without MAGIC",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
    }, criteria);

    console.log("result:", JSON.stringify(result, null, 2));
    expect(result.recommendedAction).toBe("revise");
    expect(result.passed).toBe(true); // required criteria all passed
    expect(result.criteriaFailed).toBe(1);
  });

  it("empty criteria: should use base verification", () => {
    const result = verifyAgainstCriteria({
      traceId: "debug",
      artifactType: "text",
      content: "Empty",
      security: { artifactToManager: false, rawHistoryToWorker: false, rawMemoryToWorker: false },
    }, []);

    console.log("empty criteria result:", JSON.stringify(result, null, 2));
    // Empty content → VF-001 error → passed=false
    expect(result.passed).toBe(false);
    expect(result.base.passed).toBe(false);
  });
});
