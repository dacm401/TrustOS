/**
 * Verify the Event Backbone hash-chain implementation.
 *
 * Run: npx tsx scripts/verify-event-chain.mts
 *
 * Proves three properties that per-event hashing alone cannot:
 *   1. linkage  — each event's prev_hash == previous event's event_hash
 *   2. tamper   — modifying an event is detected
 *   3. deletion — removing an event from the middle is detected
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  initEventStore,
  appendEvent,
  readAllEvents,
  verifyEventChain,
  getChainTail,
} from "../src/services/trst1/jsonl-event-store.js";
import type { TrstEventEnvelope } from "../src/services/trst1/event-envelope.js";

const dir = mkdtempSync(join(tmpdir(), "trustos-chain-"));
const logPath = join(dir, "events.jsonl");

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const base = (n: number) => ({
  event_id: `evt_${n}`,
  event_type: "model_call" as const,
  timestamp: new Date(Date.now() + n).toISOString(),
  trace_id: "trace-1",
  session_id: "sess-1",
  run_id: "run-1",
  project_id: "test",
  task_id: null,
  resource_type: "model" as const,
  latency_ms: 1,
  privacy_flags: [],
  status: "success" as const,
});

console.log("\n── 1. Chain linkage ──────────────────────────────────────");
initEventStore(logPath);
check("genesis: empty store has null chain tail", getChainTail() === null);

for (let i = 1; i <= 3; i++) {
  appendEvent(base(i) as unknown as Omit<TrstEventEnvelope, "event_hash">);
}

const events = readAllEvents() as Array<Record<string, unknown>>;
check("3 events written", events.length === 3, `got ${events.length}`);
check(
  "genesis event has prev_hash === null",
  events[0].prev_hash === null,
  `got ${String(events[0].prev_hash)}`,
);
check(
  "event[1].prev_hash === event[0].event_hash",
  events[1].prev_hash === events[0].event_hash,
);
check(
  "event[2].prev_hash === event[1].event_hash",
  events[2].prev_hash === events[1].event_hash,
);
check("chain verifies as intact", verifyEventChain(events).valid);
check("chain tail == last event hash", getChainTail() === events[2].event_hash);

console.log("\n── 2. Tamper detection ───────────────────────────────────");
const tampered = events.map((e, i) =>
  i === 1 ? { ...e, latency_ms: 999 } : e,
);
const tamperRes = verifyEventChain(tampered);
check("modified event detected", !tamperRes.valid, "expected invalid");
check("reports index 1", tamperRes.brokenAtIndex === 1, `got ${tamperRes.brokenAtIndex}`);

console.log("\n── 3. Deletion detection ─────────────────────────────────");
// Remove the middle event but keep the rest (simulates log tampering)
const deleted = [events[0], events[2]];
const delRes = verifyEventChain(deleted);
check(
  "deleted middle event detected",
  !delRes.valid,
  "per-event hashing alone would NOT catch this",
);
check("reports index 1", delRes.brokenAtIndex === 1, `got ${delRes.brokenAtIndex}`);

console.log("\n── 4. Chain survives restart ─────────────────────────────");
const tailBefore = getChainTail();
initEventStore(logPath); // simulate process restart
check("tail recovered from disk", getChainTail() === tailBefore);
appendEvent(base(4) as unknown as Omit<TrstEventEnvelope, "event_hash">);
const after = readAllEvents();
check(
  "post-restart event links to pre-restart tail",
  after[3].prev_hash === after[2].event_hash,
);
check("full chain intact after restart", verifyEventChain(after).valid);

rmSync(dir, { recursive: true, force: true });

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
