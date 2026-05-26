/**
 * S85P: Simple Task Fast Path — Safety Boundary Tests
 *
 * Tests cover:
 * - High-risk, tool, ambiguous, and human_review tasks remain on normal path
 * - Safety edge cases do not bypass verifier
 */

import { describe, it, expect } from "vitest";
import { classifySimpleTask } from "../../src/services/simple-task-classifier.js";
import {
  HIGH_RISK_KEYWORDS,
  SECURITY_COMPLIANCE_KEYWORDS,
  HUMAN_REVIEW_SIGNALS,
} from "../../src/types/simple-task-classifier.js";

describe("S85P Fast Path Safety Boundaries", () => {

  // ── B1: All high-risk keywords → ineligible ───────────────────────────────
  describe("high-risk keywords", () => {
    for (const kw of HIGH_RISK_KEYWORDS) {
      it(`B1: "${kw}" keyword blocks fast path`, () => {
        const result = classifySimpleTask({
          taskBrief: `Please analyze the ${kw} of the system.`,
        });
        expect(result.eligible).toBe(false);
      });
    }
  });

  // ── B2: All security/compliance keywords → ineligible ─────────────────────
  describe("security/compliance keywords", () => {
    for (const kw of SECURITY_COMPLIANCE_KEYWORDS) {
      it(`B2: "${kw}" keyword blocks fast path`, () => {
        const result = classifySimpleTask({
          taskBrief: `Review ${kw} requirements for this project.`,
        });
        expect(result.eligible).toBe(false);
      });
    }
  });

  // ── B3: All human review signals → ineligible ─────────────────────────────
  describe("human review signals", () => {
    for (const signal of HUMAN_REVIEW_SIGNALS) {
      it(`B3: "${signal}" signal blocks fast path`, () => {
        const result = classifySimpleTask({
          taskBrief: `This task ${signal}.`,
        });
        expect(result.eligible).toBe(false);
      });
    }
  });

  // ── B4: Tool + side-effect combinations → ineligible ──────────────────────
  describe("tool and side-effect combinations", () => {
    it("B4.1: tool calls block fast path even on simple text", () => {
      const result = classifySimpleTask({
        taskBrief: "Simple summary.",
        hasToolCalls: true,
      });
      expect(result.eligible).toBe(false);
    });

    it("B4.2: side effects block fast path even on simple text", () => {
      const result = classifySimpleTask({
        taskBrief: "Simple summary.",
        hasExternalSideEffects: true,
      });
      expect(result.eligible).toBe(false);
    });

    it("B4.3: both tool calls and side effects block fast path", () => {
      const result = classifySimpleTask({
        taskBrief: "Simple summary.",
        hasToolCalls: true,
        hasExternalSideEffects: true,
      });
      expect(result.eligible).toBe(false);
    });
  });

  // ── B5: Revision tasks always ineligible ──────────────────────────────────
  describe("revision task safety", () => {
    it("B5.1: revision task is ineligible even for trivial change", () => {
      const result = classifySimpleTask({
        taskBrief: "Change the word 'hello' to 'hi'.",
        isRevisionTask: true,
      });
      expect(result.eligible).toBe(false);
    });

    it("B5.2: revision task with short prompt is still ineligible", () => {
      const result = classifySimpleTask({
        taskBrief: "Fix typo.",
        isRevisionTask: true,
      });
      expect(result.eligible).toBe(false);
    });
  });

  // ── B6: Combined risk signals ─────────────────────────────────────────────
  describe("combined risk signals", () => {
    it("B6.1: short text with embedded security keyword is blocked", () => {
      const result = classifySimpleTask({
        taskBrief: "Check password reset flow.",
      });
      expect(result.eligible).toBe(false);
    });

    it("B6.2: short text with embedded compliance keyword is blocked", () => {
      const result = classifySimpleTask({
        taskBrief: "Summarize the GDPR document.",
      });
      expect(result.eligible).toBe(false);
    });

    it("B6.3: long prompt without risky keywords is still blocked", () => {
      const result = classifySimpleTask({
        taskBrief: "A simple and safe task. ".repeat(100),
      });
      expect(result.eligible).toBe(false);
      expect(result.reasonCode).toBe("prompt_too_long");
    });
  });

  // ── B7: False positive prevention ─────────────────────────────────────────
  describe("false positive prevention", () => {
    it("B7.1: 'security' in normal context is flagged conservatively", () => {
      // "security" is always flagged as high-risk, even in benign context.
      // This is by design: conservative, better safe than sorry.
      const result = classifySimpleTask({
        taskBrief: "Review the office security camera footage summary.",
      });
      expect(result.eligible).toBe(false);
    });

    it("B7.2: 'password' in normal context is flagged conservatively", () => {
      const result = classifySimpleTask({
        taskBrief: "Summarize the password manager user guide.",
      });
      expect(result.eligible).toBe(false);
    });

    it("B7.3: genuinely simple text passes all checks", () => {
      const result = classifySimpleTask({
        taskBrief: "Write a haiku about spring.",
        goal: "Create a short poem",
      });
      expect(result.eligible).toBe(true);
    });
  });
});
