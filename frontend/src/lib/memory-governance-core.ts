// MWT-6-UI — Frontend-safe crypto-free copy of the MWT-6 governance core.
//
// Mirrors src/services/mwt6/memory-governance-core.ts (the crypto-free,
// frontend-safe builder). Inlined into the frontend rootDir so the client
// bundle does not cross into the backend src/ (which breaks Next.js tsc and
// risks pulling node:crypto). The backend wrapper injects a real SHA-256;
// this copy uses a deterministic pure-JS fallback hash for fixtures/UI only.

import type {
  MemoryGovernanceInput,
  MemoryGovernanceRecord,
  MemoryGovernanceOptions,
  MemoryGovernanceStatus,
  TrustSpineRefs,
} from "@/types/memory-governance";

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

// Pure-JS deterministic fallback hash (FNV-1a 32-bit, hex). NOT cryptographic.
function simpleHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

const EXPLICIT_SCOPES = new Set(["user", "session", "task", "project", "system"]);
const EXPLICIT_SOURCES = new Set([
  "user_input",
  "assistant_output",
  "task_result",
  "evidence_report",
  "approval_review",
  "system_policy",
  "imported_legacy",
]);
const EXPLICIT_RETENTIONS = new Set([
  "ephemeral",
  "session",
  "project",
  "long_term",
  "revoked",
  "expired",
]);
const EXPLICIT_SENSITIVITIES = new Set([
  "public",
  "internal",
  "sensitive",
  "restricted",
  "unknown",
]);

function isWellFormedRef(ref: unknown): boolean {
  return typeof ref === "string" && ref.trim().length > 0;
}

function collectWarnings(
  input: MemoryGovernanceInput,
  nowMs: number,
): { warnings: string[]; derivedExpired: boolean; derivedRevoked: boolean } {
  const warnings: string[] = [];
  let derivedExpired = false;
  let derivedRevoked = false;

  if (!input.scope || !EXPLICIT_SCOPES.has(input.scope)) {
    warnings.push(
      `Scope "${input.scope ?? "undefined"}" is not an explicit known scope; record is invalid until scope is set.`,
    );
  }
  if (!input.source || !EXPLICIT_SOURCES.has(input.source)) {
    warnings.push(`Source "${input.source ?? "undefined"}" is not a recognized source; treat as unverified.`);
  }
  if (input.source === "imported_legacy") {
    warnings.push("Memory imported from legacy source; not cryptographically verifiable.");
  }
  if (!input.sensitivity || !EXPLICIT_SENSITIVITIES.has(input.sensitivity)) {
    warnings.push(`Sensitivity "${input.sensitivity ?? "undefined"}" is unknown; do NOT treat as public — restricted by default.`);
  }
  if (input.sensitivity === "sensitive" || input.sensitivity === "restricted") {
    warnings.push(`Memory sensitivity "${input.sensitivity}" requires access restriction.`);
  }
  if (!input.retention || !EXPLICIT_RETENTIONS.has(input.retention)) {
    warnings.push(`Retention "${input.retention ?? "undefined"}" is not an explicit policy.`);
  }
  if (input.expires_at) {
    const exp = Date.parse(input.expires_at);
    if (Number.isNaN(exp)) {
      warnings.push("expires_at is present but not a valid ISO timestamp.");
    } else if (exp < nowMs) {
      derivedExpired = true;
      warnings.push("Memory is past its expires_at; treated as expired.");
    }
  }
  if (input.revoked_at) {
    const rev = Date.parse(input.revoked_at);
    if (Number.isNaN(rev)) {
      warnings.push("revoked_at is present but not a valid ISO timestamp.");
    } else {
      derivedRevoked = true;
      warnings.push("Memory has been revoked.");
    }
  }
  if (input.retention === "revoked") derivedRevoked = true;
  if (input.retention === "expired") derivedExpired = true;

  const trust: TrustSpineRefs = input.trust_refs ?? {};
  const refChecks: Array<[string, unknown]> = [
    ["evidence_report_id", trust.evidence_report_id],
    ["evidence_fingerprint", trust.evidence_fingerprint],
    ["approval_id", trust.approval_id],
    ["binding_fingerprint", trust.binding_fingerprint],
    ["review_id", trust.review_id],
  ];
  for (const [label, val] of refChecks) {
    if (val !== undefined && val !== null && !isWellFormedRef(val)) {
      warnings.push(`Trust Spine ref ${label} is present but malformed.`);
    }
  }
  for (const arr of [input.evidence_refs, input.approval_refs, input.review_refs, input.provenance_refs]) {
    if (Array.isArray(arr)) {
      for (const r of arr) {
        if (!isWellFormedRef(r)) {
          warnings.push("A linkage ref array contains a malformed entry.");
          break;
        }
      }
    }
  }
  const hasTrustRefs =
    Object.values(trust).some((v) => v !== undefined && v !== null) ||
    (input.evidence_refs?.length ?? 0) > 0 ||
    (input.approval_refs?.length ?? 0) > 0 ||
    (input.review_refs?.length ?? 0) > 0;
  if (hasTrustRefs && input.source !== "approval_review" && input.source !== "evidence_report") {
    warnings.push("Memory references Trust Spine artifacts but source is not a Trust Spine artifact; linkage is recorded, not verified.");
  }
  return { warnings, derivedExpired, derivedRevoked };
}

function deriveStatus(
  input: MemoryGovernanceInput,
  warnings: string[],
  derivedExpired: boolean,
  derivedRevoked: boolean,
): MemoryGovernanceStatus {
  if (!input.scope || !EXPLICIT_SCOPES.has(input.scope)) return "invalid";
  if (derivedRevoked) return "revoked";
  if (derivedExpired) return "expired";
  if (input.source === "imported_legacy") return "legacy";
  if (!input.source || !EXPLICIT_SOURCES.has(input.source)) return "unverified";
  const sens = input.sensitivity;
  if (sens === "sensitive" || sens === "restricted") return "limited";
  if (!sens || !EXPLICIT_SENSITIVITIES.has(sens)) return "limited";
  if (sens === "unknown") return "limited";
  return "active";
}

export function buildMemoryGovernanceRecord(
  input: MemoryGovernanceInput,
  opts: MemoryGovernanceOptions = {},
): MemoryGovernanceRecord {
  const now = opts.now ?? Date.now;
  const hashFn = opts.hashFn ?? simpleHash;
  const nowMs = now();
  const evaluated_at = new Date(nowMs).toISOString();

  const { warnings, derivedExpired, derivedRevoked } = collectWarnings(input, nowMs);
  const status = deriveStatus(input, warnings, derivedExpired, derivedRevoked);

  const provenance_refs = input.provenance_refs ?? [];
  const evidence_refs = input.evidence_refs ?? [];
  const approval_refs = input.approval_refs ?? [];
  const review_refs = input.review_refs ?? [];
  const trust_refs: TrustSpineRefs = input.trust_refs ?? {};

  const canonical = {
    memory_id: input.memory_id,
    content_digest: input.content_digest,
    scope: input.scope,
    source: input.source,
    created_at: input.created_at,
    created_by: input.created_by ?? null,
    retention: input.retention,
    sensitivity: input.sensitivity,
    expires_at: input.expires_at ?? null,
    revoked_at: input.revoked_at ?? null,
    provenance_refs,
    evidence_refs,
    approval_refs,
    review_refs,
    trust_refs,
    note: input.note ?? null,
    status,
    warnings,
  };

  const governance_fingerprint = "mgv_" + hashFn(stableStringify(canonical)).slice(0, 32);
  return { ...canonical, governance_fingerprint, evaluated_at };
}

export function evaluateMemoryGovernance(
  record: MemoryGovernanceRecord,
  opts: MemoryGovernanceOptions = {},
): MemoryGovernanceRecord {
  const now = opts.now ?? Date.now;
  const hashFn = opts.hashFn ?? simpleHash;
  const input: MemoryGovernanceInput = {
    memory_id: record.memory_id,
    content_digest: record.content_digest,
    scope: record.scope,
    source: record.source,
    created_at: record.created_at,
    created_by: record.created_by,
    retention: record.retention,
    sensitivity: record.sensitivity,
    expires_at: record.expires_at,
    revoked_at: record.revoked_at,
    provenance_refs: record.provenance_refs,
    evidence_refs: record.evidence_refs,
    approval_refs: record.approval_refs,
    review_refs: record.review_refs,
    trust_refs: record.trust_refs,
    note: record.note,
  };
  return buildMemoryGovernanceRecord(input, { now, hashFn });
}

export { stableStringify, simpleHash };
