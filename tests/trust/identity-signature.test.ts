/**
 * TRST-4E v0 — signer_identity attribution test.
 *
 * Validates that enforcement events and evidence anchors carry attribution
 * metadata (who triggered the action), without introducing a key store.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PolicyCheckRequest } from "../../src/trust/policy-engine.js";
import * as jsonlStore from "../../src/services/trst1/jsonl-event-store.js";
import { enforceBeforeLlmCall, addDenyRule } from "../../src/trust/policy-enforcement.js";
import { buildAnchor } from "../../src/trust/evidence-anchor.js";

const captured: any[] = [];
let spy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  captured.length = 0;
  spy = vi.spyOn(jsonlStore, "appendEvent").mockImplementation(async (e: any) => {
    captured.push(e);
    return undefined as any;
  });
});

afterEach(() => {
  spy.mockRestore();
});

function makeReq(userId: string): PolicyCheckRequest {
  return {
    data: { x: 1 },
    dataType: "user_message",
    recipient: "external_api",
    userId,
    sessionId: "sess-4e",
    source: "model-gateway:gpt-4o",
  };
}

describe("4E signer_identity attribution", () => {
  it("enforcement event defaults signer_identity to req.userId", () => {
    // dry_run default: a deny rule logs divergence (does not throw)
    addDenyRule("t-4e-block", "block test", (r) => r.userId === "u-block", "blocked-for-test");
    enforceBeforeLlmCall(makeReq("u-block"));
    const ev = captured.find((e) => e.event_type === "policy_enforcement");
    expect(ev).toBeDefined();
    expect(ev.signer_identity.user_id).toBe("u-block");
  });

  it("enforcement event honors explicit signer fingerprint when provided", () => {
    enforceBeforeLlmCall(makeReq("u-fp"), {
      user_id: "u-fp",
      public_key_fingerprint: "abc123",
    });
    // live mode emits on allow path; dry_run does not, so force deny again
    addDenyRule("t-4e-block2", "block test2", () => true, "blocked");
    enforceBeforeLlmCall(makeReq("u-fp"), {
      user_id: "u-fp",
      public_key_fingerprint: "abc123",
    });
    const ev = captured.find((e) => e.signer_identity?.public_key_fingerprint === "abc123");
    expect(ev).toBeDefined();
    expect(ev.signer_identity.user_id).toBe("u-fp");
    expect(ev.signer_identity.public_key_fingerprint).toBe("abc123");
  });

  it("evidence anchor carries signer_identity", () => {
    const anchor = buildAnchor(
      { user_id: "exporter-1", public_key_fingerprint: "fp-x" },
      [{ event_hash: "a".repeat(64) } as any],
    );
    expect(anchor.signer_identity.user_id).toBe("exporter-1");
    expect(anchor.signer_identity.public_key_fingerprint).toBe("fp-x");
  });

  it("evidence anchor defaults signer to system when omitted", () => {
    const anchor = buildAnchor(undefined, [{ event_hash: "b".repeat(64) } as any]);
    expect(anchor.signer_identity.user_id).toBe("system");
    expect(anchor.signer_identity.public_key_fingerprint).toBeUndefined();
  });
});
