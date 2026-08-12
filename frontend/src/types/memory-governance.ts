// MWT-6-UI — Frontend type surface for Memory Governance.
//
// Re-exports the deterministic MWT-6 core types + builder so the UI layer
// shares EXACTLY the same type definitions as the governance evaluator
// (src/services/mwt6/memory-governance-types). The UI never re-declares or
// re-implements governance logic; it only renders records produced by the
// core builder.
//
// IMPORTANT (MWT-7B): the builder is imported from `memory-governance-core`
// (crypto-free), NOT from `memory-governance` (backend wrapper that imports
// node:crypto). This keeps `node:crypto` out of the client bundle.

export type {
  MemoryGovernanceRecord,
  MemoryGovernanceInput,
  MemoryScope,
  MemorySource,
  MemoryRetention,
  MemorySensitivity,
  MemoryGovernanceStatus,
  TrustSpineRefs,
} from "../../../src/services/mwt6/memory-governance-types";

export {
  buildMemoryGovernanceRecord,
  evaluateMemoryGovernance,
} from "../../../src/services/mwt6/memory-governance-core";
