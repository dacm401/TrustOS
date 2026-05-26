/**
 * S85P: Simple Task Classifier — Unit Tests
 *
 * Tests cover:
 * - Simple no-tool task → eligible
 * - Tool task → not eligible
 * - Revision task → not eligible
 * - Long prompt → not eligible
 * - Any criteria → not eligible (V0: criteriaCount === 0)
 * - High-risk keyword → not eligible
 * - Security/compliance keyword → not eligible
 * - Human review signal → not eligible
 * - External side effects → not eligible
 * - Boundary cases: empty input, defaults
 */

import { describe, it, expect } from "vitest";
import { classifySimpleTask } from "../../src/services/simple-task-classifier.js";
import {
  type SimpleTaskClassification,
  type SimpleTaskReasonCode,
  S85P_DEFAULTS,
} from "../../src/types/simple-task-classifier.js";

describe("S85P SimpleTaskClassifier", () => {

  // ── T1: Simple task → eligible ───────────────────────────────────────────────
  describe("eligible tasks", () => {
    it("T1.1: simple summary task is eligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Summarize the key points from the meeting notes.",
        goal: "Generate a concise summary",
      });
      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe("simple_no_tool_low_risk");
    });

    it("T1.2: simple rewrite task is eligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Rewrite this paragraph to be more concise.",
        goal: "Improve writing clarity",
      });
      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe("simple_no_tool_low_risk");
    });

    it("T1.3: simple format conversion is eligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Convert the following markdown to plain text.",
      });
      expect(result.eligible).toBe(true);
    });

    it("T1.4: short text classification is eligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Classify this customer feedback as positive or negative.",
      });
      expect(result.eligible).toBe(true);
    });

    it("T1.5: short plan draft WITH sections is ineligible (V0 criteria rule)", () => {
      const result = classifySimpleTask({
        taskBrief: "Draft a short plan for tomorrow's team meeting.",
        sections: ["agenda", "goals"],
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_verification_criteria");
    });

    it("T1.6: short plan draft WITHOUT sections is eligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Draft a short plan for tomorrow's team meeting.",
      });
      expect(result.eligible).toBe(true);
    });
  });

  // ── T2: Tool calls → ineligible ─────────────────────────────────────────────
  describe("tool calls", () => {
    it("T2.1: task with tool calls is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Search for the latest news about AI.",
        hasToolCalls: true,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_tool_calls");
    });
  });

  // ── T3: External side effects → ineligible ──────────────────────────────────
  describe("external side effects", () => {
    it("T3.1: task with external side effects is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Send an email to the team.",
        hasExternalSideEffects: true,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_external_side_effects");
    });
  });

  // ── T4: Revision task → ineligible ──────────────────────────────────────────
  describe("revision tasks", () => {
    it("T4.1: revision task is ineligible even if simple", () => {
      const result = classifySimpleTask({
        taskBrief: "Fix the typo in the document.",
        isRevisionTask: true,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("is_revision_task");
    });
  });

  // ── T5: Prompt too long → ineligible ────────────────────────────────────────
  describe("prompt length", () => {
    it("T5.1: prompt exceeding max length is ineligible", () => {
      const longText = "A".repeat(S85P_DEFAULTS.MAX_PROMPT_LENGTH + 1);
      const result = classifySimpleTask({
        taskBrief: longText,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("prompt_too_long");
    });

    it("T5.2: prompt at exact max length is eligible", () => {
      const exactText = "A".repeat(S85P_DEFAULTS.MAX_PROMPT_LENGTH);
      const result = classifySimpleTask({
        taskBrief: exactText,
      });
      expect(result.eligible).toBe(true);
    });
  });

  // ── T6: Any verification criteria → ineligible (V0) ────────────────────────
  describe("verification criteria (V0: zero criteria allowed)", () => {
    it("T6.1: any sections make task ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Analyze this data.",
        sections: ["intro"],
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_verification_criteria");
    });

    it("T6.2: any constraints make task ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Create a report.",
        constraints: ["be concise"],
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_verification_criteria");
    });

    it("T6.3: combined sections+constraints make task ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Write a summary.",
        sections: ["abstract"],
        constraints: ["short"],
      });
      // 1 section + 1 constraint = 2 > MAX_SIMPLE_CRITERIA (0)
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_verification_criteria");
    });

    it("T6.4: zero criteria is eligible (V0 rule)", () => {
      const result = classifySimpleTask({
        taskBrief: "Write a summary.",
      });
      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe("simple_no_tool_low_risk");
    });
  });

  // ── T7: High-risk keywords → ineligible ─────────────────────────────────────
  describe("high-risk keywords", () => {
    it("T7.1: 'security' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Review the security configuration of the system.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("high_risk_keyword");
    });

    it("T7.2: 'vulnerability' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Check for XSS vulnerability in the code.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("high_risk_keyword");
    });

    it("T7.3: 'password' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Reset the user password.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("high_risk_keyword");
    });

    it("T7.4: 'data leak' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Investigate potential data leak.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("high_risk_keyword");
    });
  });

  // ── T8: Security/compliance keywords → ineligible ───────────────────────────
  describe("security/compliance keywords", () => {
    it("T8.1: 'gdpr' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Check GDPR compliance for this feature.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("security_compliance_keyword");
    });

    it("T8.2: 'medical' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Analyze medical records for patterns.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("security_compliance_keyword");
    });

    it("T8.3: 'legal advice' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Provide legal advice on this contract.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("security_compliance_keyword");
    });

    it("T8.4: 'pii' keyword is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Process PII data from the user.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("security_compliance_keyword");
    });
  });

  // ── T9: Human review signals → ineligible ───────────────────────────────────
  describe("human review signals", () => {
    it("T9.1: 'human review' signal is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "This output requires human review before publishing.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("requires_human_review");
    });

    it("T9.2: 'requires approval' signal is ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "This task requires approval from the manager.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("requires_human_review");
    });
  });

  // ── T10: Boundary cases ─────────────────────────────────────────────────────
  describe("boundary cases", () => {
    it("T10.1: empty task brief is eligible (short enough)", () => {
      const result = classifySimpleTask({
        taskBrief: "",
      });
      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe("simple_no_tool_low_risk");
    });

    it("T10.2: task with only goal is eligible", () => {
      const result = classifySimpleTask({
        taskBrief: "",
        goal: "Create a simple summary.",
      });
      expect(result.eligible).toBe(true);
    });

    it("T10.3: keyword is case-insensitive", () => {
      const result = classifySimpleTask({
        taskBrief: "Handle SECURITY issue report.",
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("high_risk_keyword");
    });

    it("T10.4: custom maxPromptLength overrides default", () => {
      const result = classifySimpleTask({
        taskBrief: "A".repeat(100),
        maxPromptLength: 50,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("prompt_too_long");
    });

    it("T10.5: V0 default rejects even one criteria", () => {
      const result = classifySimpleTask({
        taskBrief: "Simple task.",
        sections: ["a"],
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_verification_criteria");
    });
  });

  // ── T11: Result structure ───────────────────────────────────────────────────
  describe("result structure", () => {
    it("T11.1: result has all required fields", () => {
      const result = classifySimpleTask({
        taskBrief: "Hello world.",
      });
      expect(result).toHaveProperty("eligible");
      expect(result).toHaveProperty("reasonCode");
      expect(result).toHaveProperty("reason");
      expect(typeof result.eligible).toBe("boolean");
      expect(typeof result.reasonCode).toBe("string");
      expect(typeof result.reason).toBe("string");
    });

    it("T11.2: eligible result has 'simple_no_tool_low_risk' reasonCode", () => {
      const result = classifySimpleTask({
        taskBrief: "A simple task.",
      });
      expect(result.eligible).toBe(true);
      expect(result.reasonCode).toBe("simple_no_tool_low_risk");
    });

    it("T11.3: ineligible reason code matches the first disqualifying check", () => {
      // has_tool_calls is checked before prompt length
      const result = classifySimpleTask({
        taskBrief: "A".repeat(10000),
        hasToolCalls: true,
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("has_tool_calls");
    });
  });
});
