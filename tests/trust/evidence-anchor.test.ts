/**
 * TRST-4F R4 红线重设 — Evidence Anchor test.
 *
 * Validates: Merkle root computation over sealed events, idempotent root
 * (same events → same root), and self-hosted anchor file export (zero deps).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { promises as fs } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  computeEvidenceRootHash,
  buildAnchor,
  exportAnchorFile,
} from "../../src/trust/evidence-anchor.js";
import { sealEvent } from "../../src/services/trst1/event-envelope.js";
import type { TrstEventEnvelope } from "../../src/services/trst1/event-envelope.js";

function sealed(id: string, extra: Record<string, unknown> = {}): TrstEventEnvelope {
  return sealEvent({
    event_id: id,
    event_type: "model_call",
    timestamp: new Date().toISOString(),
    trace_id: "trace-x",
    session_id: "sess-x",
    run_id: "run-x",
    project_id: "proj-x",
    resource_type: "model",
    token_count: 0,
    latency_ms: 0,
    privacy_flags: [],
    ...extra,
  } as Omit<TrstEventEnvelope, "event_hash">);
}

const ANCHOR_PATH = join(tmpdir(), `trst4f-anchor-${Date.now()}.json`);

afterAll(async () => {
  try {
    await fs.unlink(ANCHOR_PATH);
  } catch {}
});

describe("R4 evidence anchor", () => {
  it("computes a stable 64-char root hash over multiple events", () => {
    const events = [sealed("e1"), sealed("e2"), sealed("e3")];
    const root = computeEvidenceRootHash(events);
    expect(root).toMatch(/^[a-f0-9]{64}$/);
    // deterministic
    expect(computeEvidenceRootHash(events)).toBe(root);
  });

  it("single event root equals its own event_hash", () => {
    const e = sealed("solo");
    expect(computeEvidenceRootHash([e])).toBe(e.event_hash);
  });

  it("different event sets produce different roots", () => {
    const a = computeEvidenceRootHash([sealed("a1"), sealed("a2")]);
    const b = computeEvidenceRootHash([sealed("a1"), sealed("a3")]);
    expect(a).not.toBe(b);
  });

  it("throws on empty event list (nothing to anchor)", () => {
    expect(() => computeEvidenceRootHash([])).toThrow();
  });

  it("buildAnchor reads from store and reports event count", () => {
    const anchor = buildAnchor([sealed("b1"), sealed("b2")]);
    expect(anchor.event_count).toBe(2);
    expect(anchor.algorithm).toBe("sha256-merkle");
    expect(anchor.root_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("exportAnchorFile writes self-hosted WORM anchor (zero network deps)", async () => {
    const anchor = exportAnchorFile(ANCHOR_PATH, [sealed("c1"), sealed("c2"), sealed("c3")]);
    const onDisk = JSON.parse(await fs.readFile(ANCHOR_PATH, "utf8"));
    expect(onDisk.root_hash).toBe(anchor.root_hash);
    expect(onDisk.event_count).toBe(3);
    expect(onDisk.algorithm).toBe("sha256-merkle");
    expect(typeof onDisk.generated_at).toBe("string");
  });
});
