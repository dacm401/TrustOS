/**
 * TRST-1 JSONL Event Store — Append-only local event persistence.
 *
 * Each mediated call produces one JSON line.
 * Write failures are NOT silent: telemetry_failure events are written
 * to a fallback file or emitted to stderr.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  computeEventHash,
  createEventId,
  sealEvent,
  type TrstEventEnvelope,
} from "./event-envelope.js";

let storePath: string;
let failurePath: string;

/**
 * Tail hash of the chain — event_hash of the last persisted event.
 * `null` means "genesis" (next event is the first in the chain).
 *
 * Maintained in memory for O(1) appends, and recovered from disk on
 * initEventStore() so the chain survives process restarts.
 */
let _lastEventHash: string | null = null;

/** Recover the chain tail from the last non-empty line of an existing log. */
function recoverChainTail(): void {
  _lastEventHash = null;
  if (!storePath || !existsSync(storePath)) return;
  try {
    const content = readFileSync(storePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as { event_hash?: string };
        if (parsed && typeof parsed.event_hash === "string") {
          _lastEventHash = parsed.event_hash;
          return;
        }
      } catch {
        // skip malformed line, keep scanning backwards
      }
    }
  } catch {
    _lastEventHash = null;
  }
}

export function initEventStore(eventLogPath: string): void {
  storePath = eventLogPath;
  failurePath = eventLogPath.replace(/\.jsonl$/, "-telemetry-failures.jsonl");

  const dir = dirname(storePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Continue the existing chain instead of restarting from genesis.
  recoverChainTail();
}

/** Current chain tail (event_hash of last persisted event). null = genesis. */
export function getChainTail(): string | null {
  return _lastEventHash;
}

/** Return the currently configured event log file path. */
export function getStorePath(): string | undefined {
  return storePath;
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
    task_id: null,
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
  // Link to the current tail BEFORE sealing, so event_hash covers prev_hash.
  const linked = { ...event, prev_hash: _lastEventHash } as Omit<
    TrstEventEnvelope,
    "event_hash"
  >;
  const sealed = sealEvent(linked);
  const line = JSON.stringify(sealed);

  const written = writeLine(storePath, line);
  if (!written) {
    emitTelemetryFailure(event, "primary store write failed");
    return;
  }

  // Advance the chain only after a confirmed durable write — otherwise a
  // failed write would leave the in-memory tail ahead of what is on disk.
  _lastEventHash = sealed.event_hash ?? null;
}

// ── Chain verification ───────────────────────────────────────────────────────

export interface ChainVerificationResult {
  valid: boolean;
  /** Number of events inspected. */
  count: number;
  /** Index (0-based) of the first event that failed, or null if chain is intact. */
  brokenAtIndex: number | null;
  /** Human-readable explanation; null when valid. */
  reason: string | null;
}

/**
 * Verify the integrity of the event hash-chain.
 *
 * Checks, in order:
 *  1. Every event's `event_hash` matches a recomputation over its own content
 *     (detects: modification of a single event).
 *  2. Every event's `prev_hash` equals the `event_hash` of the preceding event
 *     (detects: deletion of a whole event, or reordering).
 *
 * @param events Chronological (oldest-first) events, typically from
 *               `readAllEvents()`.
 */
export function verifyEventChain(
  events: Record<string, unknown>[],
): ChainVerificationResult {
  let expectedPrev: string | null = null;

  for (let i = 0; i < events.length; i++) {
    const ev = events[i] as Record<string, unknown> & {
      event_hash?: string;
      prev_hash?: string | null;
    };

    // ① per-event hash integrity
    const { event_hash, ...rest } = ev;
    const recomputed = computeEventHash(
      rest as unknown as Omit<TrstEventEnvelope, "event_hash">,
    );
    if (event_hash !== recomputed) {
      return {
        valid: false,
        count: events.length,
        brokenAtIndex: i,
        reason: `event_hash mismatch at index ${i}: content was modified after sealing`,
      };
    }

    // ② chain linkage
    if ((ev.prev_hash ?? null) !== expectedPrev) {
      return {
        valid: false,
        count: events.length,
        brokenAtIndex: i,
        reason:
          expectedPrev === null
            ? `expected genesis (prev_hash=null) at index ${i}, got ${String(ev.prev_hash)}`
            : `prev_hash mismatch at index ${i}: an event may have been deleted or reordered`,
      };
    }

    expectedPrev = event_hash ?? null;
  }

  return { valid: true, count: events.length, brokenAtIndex: null, reason: null };
}

/** Convenience: read the whole log and verify it end-to-end. */
export function verifyStoredChain(): ChainVerificationResult {
  return verifyEventChain(readAllEvents());
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

/**
 * Read the latest N events from the JSONL store.
 * Returns parsed event objects (oldest first). Skips malformed lines silently.
 * Returns [] if the file is missing, empty, or unreadable.
 * Does NOT filter or sanitize — caller must apply privacy controls.
 */
export function readEvents(limit: number): Record<string, unknown>[] {
  if (!storePath) return [];
  if (!existsSync(storePath)) return [];
  try {
    const content = readFileSync(storePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const events: Record<string, unknown>[] = [];
    // Process from end to get latest N, then unshift for chronological order
    for (let i = lines.length - 1; i >= 0 && events.length < limit; i--) {
      try {
        const parsed = JSON.parse(lines[i]);
        events.unshift(parsed);
      } catch {
        // skip malformed lines silently
      }
    }
    return events;
  } catch {
    return [];
  }
}

/**
 * Read ALL events from the JSONL store (chronological order, oldest first).
 * Returns parsed event objects. Skips malformed lines silently.
 * Returns [] if the file is missing, empty, or unreadable.
 * WARNING: For large event logs (>100K lines), use readEvents(limit) instead.
 */
export function readAllEvents(): Record<string, unknown>[] {
  if (!storePath) return [];
  if (!existsSync(storePath)) return [];
  try {
    const content = readFileSync(storePath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim().length > 0);
    const events: Record<string, unknown>[] = [];
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {
        // skip malformed lines silently
      }
    }
    return events;
  } catch {
    return [];
  }
}
