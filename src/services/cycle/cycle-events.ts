/**
 * Sprint 76P — Cycle Runtime SSE Events V0
 *
 * Cycle-level SSE event types for exposing runCycle() progress to the frontend.
 * These events are emitted via optional `onCycleEvent` callback in runCycle().
 *
 * Invariant I3: CycleEvent payloads contain ONLY metadata (type / cycleIndex /
 *   score / recommendedAction / finalStatus). No raw artifact, history, or
 *   memory content is ever included.
 */

export type CycleEventType =
  /** Entered runCycle() — cycle loop is starting */
  | "cycle.started"
  /** Verifier is being called for this cycle */
  | "cycle.verifying"
  /** Verifier returned — includes recommendedAction / score / passed */
  | "cycle.verifier_done"
  /** Worker is being called (revise or rewrite path only) */
  | "cycle.worker_started"
  /** Worker returned — content has been updated */
  | "cycle.worker_done"
  /** Cycle loop ended — any terminal state (accept / block / human_review / revised / rewritten / max_cycles_exceeded) */
  | "cycle.terminal";

export interface CycleEvent {
  /** Event type identifier */
  type: CycleEventType;
  /** Task identifier */
  taskId: string;
  /** 1-based cycle index */
  cycleIndex: number;
  /** Unix timestamp in ms */
  timestamp: number;
  /** Set on cycle.verifier_done */
  recommendedAction?: string;
  /** Set on cycle.verifier_done */
  score?: number;
  /** Set on cycle.verifier_done */
  passed?: boolean;
  /** Set on cycle.worker_started / worker_done */
  workerCalled?: boolean;
  /** Set on cycle.terminal */
  finalStatus?: string;
  /** Set on any error path */
  error?: string;
}

/** Event emitter signature — runCycle accepts this as optional callback */
export type CycleEventEmitter = (event: CycleEvent) => void | Promise<void>;
