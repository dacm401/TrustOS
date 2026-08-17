/**
 * MWT-22 / TRST-4D — Backend Assessment API test.
 * Uses app.fetch for in-process HTTP testing (S69P pattern).
 */

import { describe, it, expect } from "vitest";
import { app } from "../../src/app.js";

async function postAssess(events: unknown, includeControl = false) {
  return app.request("/v1/assess", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events, includeControl }),
  });
}

describe("POST /v1/assess", () => {
  it("rejects non-array events with 400", async () => {
    const res = await postAssess({ not: "an array" });
    expect(res.status).toBe(400);
  });

  it("rejects invalid JSON with 400", async () => {
    const res = await app.request("/v1/assess", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ broken json",
    });
    expect(res.status).toBe(400);
  });

  it("assesses a clean trace with no signals", async () => {
    const events = [
      {
        trace_id: "t1",
        agent_id: "agent-a",
        provider: "openai",
        event_type: "model_call",
        status: "success",
        event_hash: "h1",
        input_hash: "i1",
        output_hash: "o1",
        timestamp: "2026-08-17T10:00:00Z",
      },
    ];
    const res = await postAssess(events);
    expect(res.status).toBe(200);
    const json = (await res.json()) as any;
    expect(json.assessments).toHaveLength(1);
    // single event → SINGLE_EVENT_TRACE (low) signal, so riskLevel is "low", not "none"
    expect(json.assessments[0].riskLevel).toBe("low");
    expect(json.assessments[0].privacyOk).toBe(true);
    expect(json.assessments[0].traceIntegrityOk).toBe(false); // single-event trace flag
    expect(json.distribution.low).toBe(1);
    expect(json.control).toBeUndefined();
  });

  it("flags missing output_hash as medium privacy signal on success model_call", async () => {
    const events = [
      {
        trace_id: "t2",
        agent_id: "agent-a",
        event_type: "model_call",
        status: "success",
        event_hash: "h1",
        input_hash: "i1",
      },
    ];
    const res = await postAssess(events);
    const json = (await res.json()) as any;
    const sigs = json.assessments[0].signals.map((s: any) => s.code);
    expect(sigs).toContain("MISSING_OUTPUT_HASH");
    expect(json.assessments[0].riskLevel).toBe("medium");
    expect(json.assessments[0].privacyOk).toBe(false);
  });

  it("includes dry-run control recommendation when requested", async () => {
    const events = [
      {
        trace_id: "t3",
        event_type: "model_call",
        status: "success",
        // no event_hash at all → high privacy signal → would_block
      },
    ];
    const res = await postAssess(events, true);
    const json = (await res.json()) as any;
    expect(json.control).toBeDefined();
    expect(json.control[0].recommendation.action).toBe("would_block");
    expect(json.control[0].recommendation.mode).toBe("dry_run");
    expect(json.control[0].recommendation.runtimeEffect).toBe("none");
  });

  it("groups events by trace_id", async () => {
    const events = [
      { trace_id: "g1", event_type: "model_call", status: "success", event_hash: "h", input_hash: "i", output_hash: "o", agent_id: "a" },
      { trace_id: "g1", event_type: "tool_call", status: "success", event_hash: "h2", args_hash: "a2", result_hash: "r2", agent_id: "a" },
      { trace_id: "g2", event_type: "model_call", status: "success", event_hash: "h3", input_hash: "i3", output_hash: "o3", agent_id: "a" },
    ];
    const res = await postAssess(events);
    const json = (await res.json()) as any;
    expect(json.assessments).toHaveLength(2);
    expect(json.meta.traceCount).toBe(2);
    expect(json.meta.eventCount).toBe(3);
  });
});
