// MWT-6 — Memory Governance v0 backend wrapper.
//
// Re-exports the crypto-free core builder/evaluator and supplies the real
// node:crypto SHA-256 default hash for backend (server) use. The frontend MUST
// NOT import this file — it should import `memory-governance-core.ts` (or the
// frontend type re-export) to keep `node:crypto` out of the client bundle.
//
// No DB. No network.

import { createHash } from "node:crypto";
import {
  buildMemoryGovernanceRecord as coreBuild,
  evaluateMemoryGovernance as coreEvaluate,
  stableStringify,
} from "./memory-governance-core.js";
import type {
  MemoryGovernanceInput,
  MemoryGovernanceRecord,
  MemoryGovernanceOptions,
} from "./memory-governance-types.js";

function sha256Hash(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Backend build — defaults to a real SHA-256 hash (node:crypto).
 * Same signature as the core builder; only the default hashFn differs.
 */
export function buildMemoryGovernanceRecord(
  input: MemoryGovernanceInput,
  opts: MemoryGovernanceOptions = {},
): MemoryGovernanceRecord {
  return coreBuild(input, { ...opts, hashFn: opts.hashFn ?? sha256Hash });
}

/**
 * Backend evaluate — defaults to a real SHA-256 hash (node:crypto).
 */
export function evaluateMemoryGovernance(
  record: MemoryGovernanceRecord,
  opts: MemoryGovernanceOptions = {},
): MemoryGovernanceRecord {
  return coreEvaluate(record, { ...opts, hashFn: opts.hashFn ?? sha256Hash });
}

export { stableStringify };
export { sha256Hash };
