/**
 * TRST-1 Shadow Report — Generate Script
 *
 * Usage:
 *   npx tsx scripts/trst1/generate-shadow-report.ts
 *
 * Reads .trustos/events.jsonl (configurable via TRUSTOS_EVENT_LOG_PATH)
 * Writes .trustos/shadow-report.md
 */

import { generateReport } from "../../src/services/trst1/shadow-report.js";

const EVENT_LOG_PATH = process.env.TRUSTOS_EVENT_LOG_PATH ?? ".trustos/events.jsonl";
const OUTPUT_PATH = ".trustos/shadow-report.md";

console.log(`Reading events from: ${EVENT_LOG_PATH}`);

const stats = generateReport({
  eventLogPath: EVENT_LOG_PATH,
  outputPath: OUTPUT_PATH,
});

// Exit with non-zero if there were failure events (for CI/gating)
if (stats.failureEvents.length > 0) {
  console.log(`\n⚠  ${stats.failureEvents.length} failure event(s) detected.`);
  process.exitCode = 1;
}
