/**
 * TRST-1 JSONL Event Store — Append-only local event persistence.
 *
 * Each mediated call produces one JSON line.
 * Write failures are NOT silent: telemetry_failure events are written
 * to a fallback file or emitted to stderr.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createEventId, sealEvent, type TrstEventEnvelope } from "./event-envelope.js";

let storePath: string;
let failurePath: string;

export function initEventStore(eventLogPath: string): void {
  storePath = eventLogPath;
  failurePath = eventLogPath.replace(/\.jsonl$/, "-telemetry-failures.jsonl");

  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeLine(path: string, line: string): boolean {
  try {
    appendFileSync(path, line + "\n", "utf8");
    return true;
  } catch {
    return false;
  }
}

function emitTelemetryFailure(
  affectedEvent: Partial<TrstEventEnvelope>,
  reason: string,
): void {
  const failure = sealEvent({
    event_id: createEventId(),
    event_type: "telemetry_failure",
    timestamp: new Date().toISOString(),
    trace_id: affectedEvent.trace_id ?? "unknown",
    session_id: affectedEvent.session_id ?? "unknown",
    run_id: affectedEvent.run_id ?? "unknown",
    project_id: affectedEvent.project_id ?? "unknown",
    resource_type: affectedEvent.resource_type ?? "model",
    status: "failure",
    latency_ms: 0,
    privacy_flags: [],
    error_code: "EVENT_WRITE_FAILED",
    error_message: `Failed to persist event: ${reason}. Affected event_id: ${affectedEvent.event_id ?? "unknown"}`,
  });

  const line = JSON.stringify(failure);
  const written = writeLine(failurePath, line);

  // Last resort: stderr
  if (!written) {
    process.stderr.write(
      `[TRST-1] CRITICAL: Cannot write telemetry failure. ${line}\n`,
    );
  } else {
    process.stderr.write(
      `[TRST-1] Telemetry failure logged: ${failure.event_id}\n`,
    );
  }
}

/**
 * Append an event to the JSONL store.
 * Never throws — if write fails, emits a telemetry_failure event.
 * The response path MUST NOT be blocked by event persistence.
 */
export function appendEvent(event: Omit<TrstEventEnvelope, "event_hash">): void {
  const sealed = sealEvent(event);
  const line = JSON.stringify(sealed);

  const written = writeLine(storePath, line);
  if (!written) {
    emitTelemetryFailure(event, "primary store write failed");
  }
}

/**
 * Get the current event log path (for reporting).
 */
export function getEventLogPath(): string {
  return storePath;
}

/**
 * Count events in the JSONL store.
 * Returns 0 if the file does not exist or cannot be read.
 * Does NOT expose raw event content.
 */
export function countEvents(): number {
  if (!storePath) return 0;
  if (!existsSync(storePath)) return 0;
  try {
    const content = readFileSync(storePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    return lines.length;
  } catch {
    return 0;
  }
}
