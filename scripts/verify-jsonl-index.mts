/**
 * Verify the pure-JS JSONL event index (2026-08-28).
 *
 * Run: npx tsx scripts/verify-jsonl-index.mts
 *
 * Goal: the JSONL index must satisfy the SAME contract as the SQLite one
 * (queryEvents / listSessions / getStats / getEventById / getEventCount),
 * without any native dependency.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getJsonlEventIndex } from "../src/services/trst1/jsonl-event-index.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const dir = mkdtempSync(join(tmpdir(), "trustos-idx-"));
const logPath = join(dir, "events.jsonl");

const ev = (n: number, over: Record<string, unknown> = {}) => ({
  event_id: `e${n}`,
  event_type: n % 2 === 0 ? "tool_call" : "model_call",
  timestamp: `2026-08-28T00:00:0${n}.000Z`,
  session_id: n <= 2 ? "s1" : "s2",
  agent_id: n <= 2 ? "agent-a" : "agent-b",
  status: n === 3 ? "failure" : "success",
  request_mode: n === 1 ? "streaming" : "non_streaming",
  model: "m1",
  token_count: n * 10,
  input_hash: `ih${n}`,
  output_hash: `oh${n}`,
  error_code: n === 3 ? "E1" : null,
  task_id: n === 1 ? "t1" : null,
  event_hash: `h${n}`,
  prev_hash: n === 1 ? null : `h${n - 1}`,
  ...over,
});

// One malformed line must not break the reader.
const lines = [ev(1), ev(2), ev(3), ev(4)].map((e) => JSON.stringify(e));
lines.splice(2, 0, "{ this is not json");
writeFileSync(logPath, lines.join("\n") + "\n");

const idx = getJsonlEventIndex(logPath);

console.log("\n── 1. Basic contract ────────────────────────────────────");
check("event count skips malformed line", idx.getEventCount() === 4, String(idx.getEventCount()));
check("getEventById works", idx.getEventById("e2")?.event_type === "tool_call");
check("getEventById miss → undefined", idx.getEventById("nope") === undefined);
check("getDbPath === log path", idx.getDbPath() === logPath);

console.log("\n── 2. queryEvents: filtering + pagination ───────────────");
const all = idx.queryEvents({ limit: 10 });
check("returns all 4", all.events.length === 4, String(all.events.length));
check("total === 4", all.total === 4);
check("ordered chronologically", all.events[0].event_id === "e1", all.events[0]?.event_id);

const bySession = idx.queryEvents({ session_id: "s1" });
check("session filter", bySession.total === 2, String(bySession.total));

const byType = idx.queryEvents({ event_type: "tool_call" });
check("event_type filter", byType.total === 2, String(byType.total));

const byAgent = idx.queryEvents({ agent_id: "agent-b" });
check("agent filter", byAgent.total === 2, String(byAgent.total));

const byTask = idx.queryEvents({ task_id: "t1" });
check("task_id exact filter", byTask.total === 1, String(byTask.total));

const unassigned = idx.queryEvents({ task_id: null });
check("task_id=null (unassigned) filter", unassigned.total === 3, String(unassigned.total));

const paged = idx.queryEvents({ page: 1, limit: 2 });
check("pagination limits rows", paged.events.length === 2);
check("pagination reports hasMore", paged.hasMore === true);
const page2 = idx.queryEvents({ page: 2, limit: 2 });
check("page 2 returns remaining", page2.events.length === 2 && page2.events[0].event_id === "e3");

const ranged = idx.queryEvents({ from: "2026-08-28T00:00:02.000Z" });
check("timestamp range filter (from)", ranged.total === 3, String(ranged.total));

console.log("\n── 3. Hash columns present (fixes MISSING_EVENT_HASH) ───");
const row = idx.getEventById("e2");
check("event_hash exposed", row?.event_hash === "h2", String(row?.event_hash));
check("prev_hash exposed", row?.prev_hash === "h1", String(row?.prev_hash));

console.log("\n── 4. listSessions ──────────────────────────────────────");
const sessions = idx.listSessions(10);
check("2 sessions", sessions.length === 2, String(sessions.length));
const s1 = sessions.find((s) => s.session_id === "s1");
check("s1 event_count === 2", s1?.event_count === 2, String(s1?.event_count));
check("s1 model_calls === 1", s1?.model_calls === 1, String(s1?.model_calls));
check("s1 tool_calls === 1", s1?.tool_calls === 1, String(s1?.tool_calls));
check("s1 total_tokens === 30", s1?.total_tokens === 30, String(s1?.total_tokens));
check("s1 agents", JSON.stringify(s1?.agents) === '["agent-a"]', JSON.stringify(s1?.agents));

console.log("\n── 5. getStats ──────────────────────────────────────────");
const st = idx.getStats();
check("total_events === 4", st.total_events === 4, String(st.total_events));
check("model_calls === 2", st.model_calls === 2, String(st.model_calls));
check("tool_calls === 2", st.tool_calls === 2, String(st.tool_calls));
check("streaming_calls === 1", st.streaming_calls === 1, String(st.streaming_calls));
check("success_count === 3", st.success_count === 3, String(st.success_count));
check("failure_count === 1", st.failure_count === 1, String(st.failure_count));
check("unique_sessions === 2", st.unique_sessions === 2, String(st.unique_sessions));
check("unique_agents === 2", st.unique_agents === 2, String(st.unique_agents));
check("hash_coverage_pct === 100", st.hash_coverage_pct === 100, String(st.hash_coverage_pct));
check("total_tokens === 100", st.total_tokens === 100, String(st.total_tokens));

console.log("\n── 6. Cache invalidation on new writes ──────────────────");
check("count before append", idx.getEventCount() === 4);
writeFileSync(logPath, lines.join("\n") + "\n" + JSON.stringify(ev(5)) + "\n");
idx.appendEvent({} as never); // simulate runtime append → invalidate
check("count after append", idx.getEventCount() === 5, String(idx.getEventCount()));

console.log("\n── 7. Empty / missing log ───────────────────────────────");
const emptyIdx = getJsonlEventIndex(join(dir, "does-not-exist.jsonl"));
check("missing file → count 0", emptyIdx.getEventCount() === 0);
check("missing file → query returns empty", emptyIdx.queryEvents().events.length === 0);
check("missing file → stats total 0", emptyIdx.getStats().total_events === 0);

rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
