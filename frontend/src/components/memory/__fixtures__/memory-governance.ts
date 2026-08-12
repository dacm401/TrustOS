// MWT-6-UI — Deterministic fixtures for the Memory Governance Panel.
//
// These are produced by the SAME core builder used in production
// (buildMemoryGovernanceRecord), pinned to a fixed now() and a fixed
// hashFn, so the panel exercises every honest status tone WITH the real
// evaluator logic — no hand-mocked shapes, no duplicated governance logic.
//
// Coverage (PM requirement):
//   - active session memory
//   - sensitive long-term limited
//   - expired memory
//   - revoked memory
//   - legacy imported
//   - invalid missing scope
//   - evidence/review linked memory

import {
  buildMemoryGovernanceRecord,
  type MemoryGovernanceRecord,
} from "../../../types/memory-governance";

// Deterministic time + hash so fingerprints are stable across runs/tests.
// NOTE: MWT-6 core uses now() in a numeric comparison (expires_at < now), so
// now() MUST return an epoch-ms number (Date.now-style), not an ISO string.
const FIXED_NOW = Date.parse("2026-08-12T00:00:00.000Z");
const FIXED_HASH = (s: string): string =>
  "sha256:" + (s.length.toString(16).padStart(4, "0") + "f".repeat(60)).slice(0, 64);

export const activeSessionMemory: MemoryGovernanceRecord = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_active_session_01",
    content_digest: "sha256:a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
    scope: "session",
    source: "task_result",
    created_at: "2026-08-12T00:00:00.000Z",
    created_by: "agent.trustos.local",
    retention: "session",
    sensitivity: "internal",
    expires_at: "2026-08-12T01:00:00.000Z",
    trust_refs: { evidence_report_id: "rpt_active_01" },
  },
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const sensitiveLongTermLimited: MemoryGovernanceRecord = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_sensitive_lt_02",
    content_digest: "sha256:b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0b2c3",
    scope: "user",
    source: "user_input",
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: "user.ligua@trustos.local",
    retention: "long_term",
    sensitivity: "sensitive",
    expires_at: "2030-01-01T00:00:00.000Z",
    trust_refs: { approval_id: "apr_sensitive_02" },
  },
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const expiredMemory: MemoryGovernanceRecord = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_expired_03",
    content_digest: "sha256:c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0c3d4",
    scope: "task",
    source: "task_result",
    created_at: "2026-01-01T00:00:00.000Z",
    created_by: "agent.trustos.local",
    retention: "project",
    sensitivity: "internal",
    expires_at: "2026-07-01T00:00:00.000Z",
    trust_refs: {},
  },
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const revokedMemory: MemoryGovernanceRecord = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_revoked_04",
    content_digest: "sha256:d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0d4e5",
    scope: "project",
    source: "user_input",
    created_at: "2026-02-01T00:00:00.000Z",
    created_by: "user.ligua@trustos.local",
    retention: "long_term",
    sensitivity: "internal",
    expires_at: "2030-01-01T00:00:00.000Z",
    revoked_at: "2026-08-10T00:00:00.000Z",
    trust_refs: { approval_id: "apr_revoked_04" },
  },
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const legacyImported: MemoryGovernanceRecord = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_legacy_05",
    content_digest: "sha256:e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0e5f6",
    scope: "user",
    source: "imported_legacy",
    created_at: "2025-01-01T00:00:00.000Z",
    created_by: "legacy-system.migration",
    retention: "long_term",
    sensitivity: "internal",
    expires_at: "2030-01-01T00:00:00.000Z",
    trust_refs: {},
  },
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const invalidMissingScope = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_invalid_06",
    content_digest: "sha256:f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0f6a7",
    // scope intentionally omitted -> invalid
    source: "task_result",
    created_at: "2026-08-12T00:00:00.000Z",
    created_by: "agent.trustos.local",
    retention: "session",
    sensitivity: "internal",
    trust_refs: {},
  } as never,
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const evidenceReviewLinked: MemoryGovernanceRecord = buildMemoryGovernanceRecord(
  {
    memory_id: "mem_linked_07",
    content_digest: "sha256:11223344556677889900112233445566778899001122334455667788990011",
    scope: "task",
    source: "evidence_report",
    created_at: "2026-08-12T00:00:00.000Z",
    created_by: "agent.trustos.local",
    retention: "project",
    sensitivity: "internal",
    expires_at: "2027-08-12T00:00:00.000Z",
    trust_refs: {
      evidence_report_id: "rpt_linked_07",
      evidence_fingerprint: "sha256:aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00ee11ff22aa33bb44cc55dd66",
      approval_id: "apr_linked_07",
      binding_fingerprint: "sha256:44dd55ee66ff77aa88bb99cc00dd11ee22ff33aa44bb55cc66dd77ee88ff99aa",
      review_id: "rv_linked_07",
    },
  },
  { now: () => FIXED_NOW, hashFn: FIXED_HASH },
);

export const allFixtures: MemoryGovernanceRecord[] = [
  activeSessionMemory,
  sensitiveLongTermLimited,
  expiredMemory,
  revokedMemory,
  legacyImported,
  invalidMissingScope,
  evidenceReviewLinked,
];

export const fixtureByName: Record<string, MemoryGovernanceRecord> = {
  active: activeSessionMemory,
  limited: sensitiveLongTermLimited,
  expired: expiredMemory,
  revoked: revokedMemory,
  legacy: legacyImported,
  invalid: invalidMissingScope,
  evidenceReviewLinked,
};
