/**
 * TRST-1 Tool Trace CLI — Simulate a tool call
 *
 * Usage:
 *   npx tsx scripts/trst1/simulate-tool-call.ts -- read_file '{"path":"README.md"}'
 *
 * Records a tool_call event into the JSONL event store.
 * This is NOT an MCP Broker — it validates the tool_call event envelope.
 *
 * Supported tools in TRST-1B:
 *   - read_file: reads a local file and returns its content
 */

import { readFileSync, existsSync } from "node:fs";
import { initEventStore } from "../../src/services/trst1/jsonl-event-store.js";
import { executeAndRecordToolCall } from "../../src/services/trst1/tool-trace-lite.js";

const EVENT_LOG_PATH = process.env.TRUSTOS_EVENT_LOG_PATH ?? ".trustos/events.jsonl";
const PROJECT_ID = process.env.TRUSTOS_PROJECT_ID ?? "local-dev";

// ── Tool Executors ──────────────────────────────────────────────────────────

async function executeReadFile(args: unknown): Promise<{ output: unknown; error?: string }> {
  const parsed = args as { path?: string };
  if (!parsed?.path) {
    return { output: null, error: "Missing required arg: path" };
  }

  try {
    if (!existsSync(parsed.path)) {
      return { output: null, error: `File not found: ${parsed.path}` };
    }
    const content = readFileSync(parsed.path, "utf8");
    return { output: { path: parsed.path, size: content.length, preview: content.slice(0, 500) } };
  } catch (err) {
    return { output: null, error: err instanceof Error ? err.message : String(err) };
  }
}

const TOOL_EXECUTORS: Record<string, (args: unknown) => Promise<{ output: unknown; error?: string }>> = {
  read_file: executeReadFile,
};

// ── CLI ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error("Usage: npx tsx scripts/trst1/simulate-tool-call.ts -- <tool_name> '<json_args>'");
    console.error("Example: npx tsx scripts/trst1/simulate-tool-call.ts -- read_file '{\"path\":\"README.md\"}'");
    console.error("\nSupported tools:");
    console.error("  read_file  — reads a local file, args: {\"path\": \"...\"}");
    process.exit(1);
  }

  // Skip "--" if present
  const toolArgs = args[0] === "--" ? args.slice(1) : args;
  const toolName = toolArgs[0];
  const argsJson = toolArgs[1];

  if (!TOOL_EXECUTORS[toolName]) {
    console.error(`Unknown tool: ${toolName}`);
    console.error(`Supported: ${Object.keys(TOOL_EXECUTORS).join(", ")}`);
    process.exit(1);
  }

  let parsedArgs: unknown;
  try {
    parsedArgs = JSON.parse(argsJson);
  } catch {
    console.error(`Invalid JSON args: ${argsJson}`);
    process.exit(1);
  }

  initEventStore(EVENT_LOG_PATH);

  console.log(`Executing tool: ${toolName}`);
  console.log(`Args: ${JSON.stringify(parsedArgs)}`);

  const result = await executeAndRecordToolCall(
    {
      toolName,
      args: parsedArgs,
      projectId: PROJECT_ID,
    },
    TOOL_EXECUTORS[toolName],
  );

  console.log(`\nEvent recorded: ${result.event.event_id}`);
  console.log(`Status: ${result.event.status}`);
  console.log(`Args hash: ${result.argsHash}`);
  console.log(`Result hash: ${result.resultHash}`);
  console.log(`Latency: ${result.event.latency_ms} ms`);
  console.log(`Event hash: ${result.event.event_hash}`);

  if (result.event.status === "failure") {
    console.error(`Error: ${result.event.error_message}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
