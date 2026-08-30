/**
 * Verify the task state lifecycle contract (regression guard).
 *
 * Run: npx tsx scripts/verify-task-state-lifecycle.mts
 *
 * Background — the "silent infinite hang" incident:
 *   slow-worker-loop wrote `updateState(id, "running" as TaskState)`.
 *   "running" is a task_commands.status value, NOT a task_archives.state value.
 *   The `as TaskState` cast silenced the compiler, so it shipped.
 *
 *   Both consumers enumerated ACTIVE states as a whitelist:
 *     · SSE poller      → executing/delegated/waiting_result/synthesizing
 *     · SSE hard timeout→ executing/delegated/waiting_result/synthesizing
 *     · watchdog        → executing/waiting_result/delegated/synthesizing
 *   "running" matched none of them, so the task was:
 *     · never given progress events
 *     · never recognized as terminal
 *     · never killed by the hard timeout
 *   → the SSE stream hung forever and the user waited with zero feedback.
 *
 * The fix inverts the logic: everything that is NOT terminal is active.
 * These assertions lock that contract in place.
 */

import {
  isTerminalTaskState,
  TERMINAL_TASK_STATES,
  VALID_TASK_STATES,
  type TaskState,
} from "../src/types/task.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

console.log("\n── 1. Terminal states are recognized as terminal ───────");
{
  for (const s of TERMINAL_TASK_STATES) {
    check(`"${s}" is terminal`, isTerminalTaskState(s));
  }
}

console.log("\n── 2. Non-terminal valid states are NOT terminal ───────");
{
  const active: TaskState[] = ["new", "clarifying", "delegated", "executing", "waiting_result", "synthesizing"];
  for (const s of active) {
    check(`"${s}" is active (not terminal)`, !isTerminalTaskState(s));
  }
}

console.log("\n── 3. THE BUG: illegal/unknown states must be ACTIVE ───");
{
  // This is precisely the incident: "running" was written into task_archives.state.
  // It must be treated as active so the hard timeout eventually fires,
  // instead of hanging the SSE stream forever.
  check('"running" is NOT terminal (gets timeout protection)',
    !isTerminalTaskState("running"));

  // Any future unknown state must fail-safe toward "active".
  check('"chattering" (table default) is NOT terminal',
    !isTerminalTaskState("chattering"));
  check('"weird_future_state" is NOT terminal',
    !isTerminalTaskState("weird_future_state"));
  check("null is NOT terminal", !isTerminalTaskState(null));
  check("undefined is NOT terminal", !isTerminalTaskState(undefined));
  check('"" is NOT terminal', !isTerminalTaskState(""));
}

console.log("\n── 4. 'running' is not a legal task_archives.state ─────");
{
  check("VALID_TASK_STATES excludes 'running'",
    !VALID_TASK_STATES.includes("running" as TaskState));
  check("VALID_TASK_STATES includes 'executing' (the correct value)",
    VALID_TASK_STATES.includes("executing"));
}

console.log("\n── 5. Contract invariants ──────────────────────────────");
{
  const terminalInValid = TERMINAL_TASK_STATES.every((s) => VALID_TASK_STATES.includes(s));
  check("every terminal state is also a valid state", terminalInValid);

  const nonTerminal = VALID_TASK_STATES.filter((s) => !isTerminalTaskState(s));
  check("valid states partition cleanly into terminal + active",
    nonTerminal.length + TERMINAL_TASK_STATES.length === VALID_TASK_STATES.length,
    `active=${nonTerminal.length} terminal=${TERMINAL_TASK_STATES.length} total=${VALID_TASK_STATES.length}`);

  check("fail-safe: unknown ⇒ active (never terminal)",
    !isTerminalTaskState("__anything_unknown__"));
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
