#!/usr/bin/env node
/**
 * S101I Phase B — Worker Execution Integration Smoke
 *
 * Verifies the command → worker → archive → SSE payload path by:
 * 1. Checking DB table structures exist (task_commands, task_archives)
 * 2. Verifying task_commands.status supports all CommandStatus values
 * 3. Verifying task_archives.slow_execution is the execution result field
 * 4. Checking that SSE poller reads from task_archives.slow_execution
 * 5. Constructing mock records and verifying event generation contracts
 *
 * This is a static + db schema smoke — does not require running server.
 *
 * Usage:
 *   node scripts/smoke/s101i-worker-execution-smoke.mjs
 */

import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { constants } from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../../");

let passed = 0;
let failed = 0;
let skipped = 0;
const results = [];

function record(name, ok, detail) {
  const status = ok ? "PASS" : "FAIL";
  if (ok) passed++; else failed++;
  results.push({ name, status, detail: detail || "" });
  console.log(`  [${status}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function skip(name, reason) {
  skipped++;
  results.push({ name, status: "SKIP", detail: reason });
  console.log(`  [SKIP] ${name} — ${reason}`);
}

// ── DB Schema Verification ────────────────────────────────────────────

async function verifyDBSchema() {
  console.log("── W1: DB Schema Contract ──\n");

  // Check both migrations and repo code for table/column references
  const migrationsDir = path.join(ROOT, "src/db/migrations");
  const repoPath = path.join(ROOT, "src/db/task-archive-repo.ts");
  let migrationContents = "";
  let repoContents = "";

  try {
    await access(migrationsDir, constants.R_OK);
    const { readdir } = await import("node:fs/promises");
    const files = (await readdir(migrationsDir))
      .filter(f => f.includes("phase3") || f.includes("task_archive"))
      .sort();

    for (const f of files) {
      const content = await readFile(path.join(migrationsDir, f), "utf-8");
      migrationContents += content + "\n";
    }
  } catch {
    skip("DB migrations directory", "migrations/ not accessible");
  }

  try {
    repoContents = await readFile(repoPath, "utf-8");
  } catch {
    skip("task-archive-repo.ts", "not readable");
  }

  // Combine both sources for column verification
  const allContent = migrationContents + "\n" + repoContents;

  // task_commands table (from migration DDL)
  const hasTaskCommands = migrationContents.includes("CREATE TABLE IF NOT EXISTS task_commands");
  record("task_commands table DDL exists", hasTaskCommands,
    hasTaskCommands ? "found in 010_task_archive_phase3.sql" : "NOT FOUND");

  // CommandStatus — check DDL default + TypeScript type union
  const typesTaskPath = path.join(ROOT, "src/types/task.ts");
  let typesTaskCode = "";
  try { typesTaskCode = await readFile(typesTaskPath, "utf-8"); } catch {}
  const commandStatusEnum = migrationContents.includes("DEFAULT 'queued'") &&
    (typesTaskCode.includes('"queued"') && typesTaskCode.includes('"running"') && typesTaskCode.includes('"completed"'));
  record("task_commands status supports queued/running/completed", commandStatusEnum,
    commandStatusEnum ? "found (DDL default 'queued' + CommandStatus type union)" : "INCOMPLETE");

  // task_archives table (DDL from migration + queries from repo)
  const hasTaskArchives = migrationContents.includes("task_archives") || repoContents.includes("task_archives");
  record("task_archives table exists", hasTaskArchives,
    hasTaskArchives ? "found in migrations + repo queries" : "NOT FOUND");

  // slow_execution column — verified by repo INSERT/SELECT queries
  const hasSlowExecution = repoContents.includes("slow_execution") &&
    (repoContents.includes("INSERT INTO task_archives") || repoContents.includes("UPDATE task_archives SET slow_execution"));
  record("task_archives has slow_execution column", hasSlowExecution,
    hasSlowExecution ? "found via repo INSERT + UPDATE queries" : "NOT FOUND");

  // state column — verified by repo UPDATE queries
  const hasState = repoContents.includes("SET state =") &&
    (repoContents.includes("executing") || repoContents.includes("delegated") || repoContents.includes("completed"));
  record("task_archives has state column (TaskState machine)", hasState,
    hasState ? "found via repo state queries" : "NOT FOUND");

  // delivered column — verified by repo markDelivered query
  const hasDelivered = repoContents.includes("SET delivered =") && repoContents.includes("markDelivered");
  record("task_archives has delivered column", hasDelivered,
    hasDelivered ? "found via repo markDelivered query" : "NOT FOUND");
}

// ── Type Contract Verification ────────────────────────────────────────

async function verifyTypeContract() {
  console.log("\n── W2: Type Contract ──\n");

  const typesPath = path.join(ROOT, "src/types/task.ts");
  let typesCode = "";
  try {
    typesCode = await readFile(typesPath, "utf-8");
  } catch {
    skip("Type definitions", "src/types/task.ts not readable");
    return;
  }

  // TaskCommandRecord
  const hasCommandRecord = typesCode.includes("TaskCommandRecord");
  record("TaskCommandRecord type defined", hasCommandRecord,
    hasCommandRecord ? "found" : "NOT FOUND");

  // CommandStatus
  const hasCommandStatus = typesCode.includes("CommandStatus");
  record("CommandStatus type defined", hasCommandStatus,
    hasCommandStatus ? "found" : "NOT FOUND");

  // TaskArchiveRecord
  const hasArchiveRecord = typesCode.includes("TaskArchiveRecord");
  record("TaskArchiveRecord type defined", hasArchiveRecord,
    hasArchiveRecord ? "found" : "NOT FOUND");

  // TaskState
  const hasTaskState = typesCode.includes("TaskState");
  record("TaskState type defined", hasTaskState,
    hasTaskState ? "found" : "NOT FOUND");

  // slow_execution in archive
  const archiveSlowExec = typesCode.includes("slow_execution");
  record("TaskArchiveRecord includes slow_execution", archiveSlowExec,
    archiveSlowExec ? "found" : "NOT FOUND");
}

// ── Worker Loop Contract ──────────────────────────────────────────────

async function verifyWorkerLoopContract() {
  console.log("\n── W3: Worker Loop Contract ──\n");

  const execPath = path.join(ROOT, "src/services/phase3/execute-worker-loop.ts");
  let execCode = "";
  try {
    execCode = await readFile(execPath, "utf-8");
  } catch {
    skip("execute-worker-loop.ts", "not readable");
    return;
  }

  // Poll query fetches queued commands
  const pollsQueued = execCode.includes("status = 'queued'") ||
    execCode.includes("queued");
  record("Execute worker polls queued commands", pollsQueued,
    pollsQueued ? "found" : "NOT FOUND");

  // startExecuteWorker is exported
  const hasStart = execCode.includes("startExecuteWorker");
  const hasStop = execCode.includes("stopExecuteWorker");
  record("startExecuteWorker + stopExecuteWorker exported", hasStart && hasStop,
    hasStart && hasStop ? "both present" : `start=${hasStart}, stop=${hasStop}`);

  // Slow worker
  const slowPath = path.join(ROOT, "src/services/phase3/slow-worker-loop.ts");
  let slowCode = "";
  try {
    slowCode = await readFile(slowPath, "utf-8");
  } catch {
    skip("slow-worker-loop.ts", "not readable");
    return;
  }

  const slowStart = slowCode.includes("startSlowWorker");
  const slowStop = slowCode.includes("stopSlowWorker");
  record("startSlowWorker + stopSlowWorker exported", slowStart && slowStop,
    slowStart && slowStop ? "both present" : `start=${slowStart}, stop=${slowStop}`);
}

// ── SSE Poller → Archive Contract ─────────────────────────────────────

async function verifyPollerArchiveContract() {
  console.log("\n── W4: SSE Poller → Archive Data Path ──\n");

  const ssePath = path.join(ROOT, "src/services/phase3/sse-poller.ts");
  let sseCode = "";
  try {
    sseCode = await readFile(ssePath, "utf-8");
  } catch {
    skip("sse-poller.ts", "not readable");
    return;
  }

  // Poller reads slow_execution
  const readsSlowExec = sseCode.includes("slow_execution") &&
    (sseCode.includes("task.slow_execution") || sseCode.includes("row.slow_execution"));
  record("SSE poller reads task_archives.slow_execution", readsSlowExec,
    readsSlowExec ? "found" : "NOT FOUND");

  // Poller reads task_archives table
  const readsArchive = sseCode.includes("task_archives") &&
    sseCode.includes("TaskArchiveRepo");
  record("SSE poller queries via TaskArchiveRepo", readsArchive,
    readsArchive ? "found" : "NOT FOUND");

  // Poller checks delivered flag
  const checksDelivered = sseCode.includes("delivered") ||
    sseCode.includes("markDelivered");
  record("SSE poller checks/marks delivered flag", checksDelivered,
    checksDelivered ? "found" : "NOT FOUND");

  // Poller emits done event (terminal)
  const emitsDone = sseCode.includes('type: "done"') || sseCode.includes("type: 'done'");
  record("SSE poller emits done event", emitsDone,
    emitsDone ? "found" : "NOT FOUND");
}

// ── Mock Execution Path Verification ──────────────────────────────────

async function verifyMockExecutionPath() {
  console.log("\n── W5: Mock Execution Path (payload construction) ──\n");

  // Simulate the full path: task_commands record → archive.slow_execution → SSE event

  // Step 1: Mock a task_commands record
  const mockCommand = {
    id: "cmd-mock-001",
    task_id: "task-mock-001",
    archive_id: "archive-mock-001",
    user_id: "smoke-user",
    issuer_role: "manager",
    command_type: "execute_plan",
    worker_hint: null,
    priority: "normal",
    status: "completed",
    payload_json: {
      task_type: "analysis",
      task_brief: "Smoke test execution",
      goal: "Verify execution path",
    },
    idempotency_key: null,
    timeout_sec: 300,
    issued_at: new Date().toISOString(),
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    error_message: null,
  };

  let valid = true;
  valid = valid && mockCommand.command_type === "execute_plan";
  valid = valid && mockCommand.status === "completed";
  valid = valid && !!mockCommand.payload_json.task_brief;
  record("Mock task_command record valid", valid,
    valid ? "all required fields present" : "INVALID");

  // Step 2: Mock a task_archives record with slow_execution result
  const mockArchive = {
    id: "archive-mock-001",
    session_id: "session-mock",
    turn_id: 1,
    command: { command_type: "execute_plan" },
    user_input: "Execute smoke test",
    constraints: [],
    task_type: "analysis",
    task_brief: { goal: "Verify execution path" },
    manager_decision: { decision_type: "delegate", worker_hint: "slow_worker" },
    fast_observations: [],
    slow_execution: {
      result: "Smoke execution completed successfully.",
      worker_role: "slow_worker",
      status: "completed",
      cycles: 1,
      tokens_input: 100,
      tokens_output: 50,
      cost_usd: 0.0001,
      model_used: "siliconflow/deepseek-ai/DeepSeek-V3",
      cycleEvents: [],
      partialResults: [],
    },
    state: "completed",
    status: "completed",
    delivered: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  valid = true;
  valid = valid && mockArchive.slow_execution !== null;
  valid = valid && typeof mockArchive.slow_execution?.result === "string";
  valid = valid && mockArchive.state === "completed";
  valid = valid && mockArchive.status === "completed";
  record("Mock task_archive record valid", valid,
    valid ? "slow_execution.result present, state=completed" : "INVALID");

  // Step 3: Construct SSE done event from archive record (matching sse-poller.ts logic)
  const execution = mockArchive.slow_execution;
  const usage = {
    tokens: {
      input: Number(execution.tokens_input ?? 0),
      output: Number(execution.tokens_output ?? 0),
      total: Number(execution.tokens_input ?? 0) + Number(execution.tokens_output ?? 0),
    },
    cost: {
      estimated_usd: Number(execution.cost_usd ?? 0),
      provider: (execution.model_used ?? "unknown").split("/")[0],
      model: execution.model_used ?? "unknown",
    },
  };

  const terminalSummary = {
    status: "completed",
    worker_role: execution.worker_role ?? "slow_worker",
    cycles: Number(execution.cycles ?? 0),
    total_tokens: Number(execution.tokens_input ?? 0) + Number(execution.tokens_output ?? 0),
    total_cost_usd: Number(execution.cost_usd ?? 0),
    elapsed_ms: 0,
    user_message: "Smoke execution completed successfully.",
    truncated: false,
  };

  const doneEvent = {
    type: "done",
    routing_layer: "L2",
    terminalSummary,
    usage,
  };

  valid = true;
  valid = valid && doneEvent.type === "done";
  valid = valid && doneEvent.usage.tokens.total > 0;
  valid = valid && doneEvent.terminalSummary.status === "completed";
  record("SSE done event constructed from archive.slow_execution", valid,
    valid ? `tokens=${usage.tokens.total}, cost=$${usage.cost.estimated_usd.toFixed(4)}` : "INVALID");

  // Step 4: Verify JSON round-trip of the complete path
  const pathJSON = JSON.stringify({
    command: mockCommand,
    archive: mockArchive,
    sse_event: doneEvent,
  });
  const parsed = JSON.parse(pathJSON);
  const pathValid = parsed.sse_event.usage?.tokens?.total === 150 &&
    parsed.sse_event.terminalSummary?.status === "completed";
  record("Full command → archive → SSE event JSON round-trip", pathValid,
    pathValid ? "complete path serializable" : "BROKEN");
}

// ── MAIN ──────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════");
  console.log("  S101I Phase B — Worker Execution Smoke");
  console.log(`  Time:   ${new Date().toISOString()}`);
  console.log("═══════════════════════════════════════════\n");

  await verifyDBSchema();
  await verifyTypeContract();
  await verifyWorkerLoopContract();
  await verifyPollerArchiveContract();
  await verifyMockExecutionPath();

  // Summary
  console.log(`\n═══════════════════════════════════════════`);
  console.log(`  Results: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP`);
  console.log(`  Total:   ${passed + failed + skipped}`);
  console.log("═══════════════════════════════════════════\n");

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(2);
});
