/**
 * TRST-4F Policy Enforcement — action-half integration test (v0: BLOCK only).
 *
 * Covers: dry_run never blocks, live+deny throws PolicyBlockedError, and
 * enforcement events are written to the Event Backbone as hash-only records.
 *
 * NOTE: the engine is a module-level singleton, so deny rules accumulate across
 * tests. To keep tests isolated we scope each deny rule to a unique marker source
 * instead of clearing rules.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  enforceBeforeLlmCall,
  addDenyRule,
  PolicyBlockedError,
  currentEnforcementMode,
} from "../../src/trust/policy-enforcement.js";
import { initEventStore } from "../../src/services/trst1/jsonl-event-store.js";
import { config } from "../../src/config.js";
import type { PolicyCheckRequest } from "../../src/trust/policy-engine.js";

const EVENT_LOG = join(tmpdir(), `trst4f-events-${Date.now()}.jsonl`);

beforeAll(() => {
  initEventStore(EVENT_LOG);
});

afterEach(async () => {
  config.policyEnforcementMode = "dry_run";
  try {
    await fs.writeFile(EVENT_LOG, "", "utf8");
  } catch {}
});

function makeReq(marker?: string): PolicyCheckRequest {
  return {
    data: { model: "gpt-4o", kind: "unknown" },
    dataType: "user_message",
    recipient: "external_api",
    userId: "system",
    sessionId: "sess-test-123",
    source: marker ? `model-gateway:block-me:${marker}` : "model-gateway:gpt-4o",
  };
}

describe("TRST-4F enforcement checkpoint", () => {
  it("dry_run: no deny rule → allow, never blocks", () => {
    const out = enforceBeforeLlmCall(makeReq());
    expect(out.decision).toBe("allow");
    expect(out.blocked).toBe(false);
    expect(out.mode).toBe("dry_run");
  });

  it("dry_run: deny rule → logs divergence but does NOT throw (shadow)", () => {
    addDenyRule("test-deny-1", "block test", (req) => (req.source ?? "").includes("block-me:1"), "blocked by test rule");
    const out = enforceBeforeLlmCall(makeReq("1"));
    expect(out.decision).toBe("deny");
    expect(out.blocked).toBe(false); // dry_run never actually blocks
    expect(out.mode).toBe("dry_run");
  });

  it("dry_run: deny rule does not affect unrelated (non-matching) traffic", () => {
    addDenyRule("test-deny-nomatch", "block test", (req) => (req.source ?? "").includes("block-me:nomatch"), "n/a");
    const out = enforceBeforeLlmCall(makeReq()); // no marker → no match → allow
    expect(out.decision).toBe("allow");
  });

  it("live: deny rule → throws PolicyBlockedError", () => {
    addDenyRule("test-deny-2", "block test live", (req) => (req.source ?? "").includes("block-me:2"), "blocked by live test rule");
    config.policyEnforcementMode = "live";
    expect(currentEnforcementMode()).toBe("live");
    expect(() => enforceBeforeLlmCall(makeReq("2"))).toThrow(PolicyBlockedError);
  });

  it("live: no matching deny rule → allow, passes through", () => {
    config.policyEnforcementMode = "live";
    const out = enforceBeforeLlmCall(makeReq()); // no marker → allow
    expect(out.decision).toBe("allow");
    expect(out.blocked).toBe(false);
  });

  it("emits a hash-only enforcement event (no raw payload) to Event Backbone", async () => {
    addDenyRule("test-deny-3", "block test event", (req) => (req.source ?? "").includes("block-me:3"), "blocked for event test");
    config.policyEnforcementMode = "live";
    try {
      enforceBeforeLlmCall(makeReq("3"));
    } catch (e) {
      expect(e).toBeInstanceOf(PolicyBlockedError);
    }
    const raw = await fs.readFile(EVENT_LOG, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const evt = JSON.parse(lines[0]);
    expect(evt.event_type).toBe("policy_enforcement");
    expect(evt.decision).toBe("deny");
    expect(evt.enforcement_mode).toBe("live");
    expect(evt.blocked).toBe("true");
    // Red line: raw request payload must NOT be present
    expect(JSON.stringify(evt)).not.toContain("block-me");
    expect(evt.payload_hash).toMatch(/^[a-f0-9]{64}$/);
  });
});
