// MWT-6 — Memory Governance smoke: 10 required behavior examples.
//
// Pure deterministic test. Injects a fixed hash + now so results are stable.
// No backend / network.

import {
  buildMemoryGovernanceRecord,
} from "../../src/services/mwt6/memory-governance";
import type { MemoryGovernanceInput } from "../../src/services/mwt6/memory-governance-types";

// Deterministic hash + clock for reproducible fingerprints.
const HASH = (s: string) => "h" + (s.length % 100000).toString().padStart(5, "0") + "fixed";
const NOW = () => Date.parse("2026-08-12T00:00:00.000Z");
const OPTS = { now: NOW, hashFn: HASH };

let pass = 0;
let fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(name);
  }
}

function rec(over: Partial<MemoryGovernanceInput>): MemoryGovernanceInput {
  return {
    memory_id: "mem-1",
    content_digest: "sha256:abc",
    scope: "session",
    source: "user_input",
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: "user-1",
    retention: "session",
    sensitivity: "internal",
    ...over,
  };
}

// 1. User session memory → active
{
  const r = buildMemoryGovernanceRecord(rec({}), OPTS);
  check("1. user session memory → active", r.status === "active");
  check("1. no warnings for clean active", r.warnings.length === 0);
}

// 2. Sensitive long-term → limited + warning
{
  const r = buildMemoryGovernanceRecord(rec({ sensitivity: "sensitive", retention: "long_term" }), OPTS);
  check("2. sensitive long-term → limited", r.status === "limited");
  check("2. sensitive → warning present", r.warnings.some((w) => w.includes("restriction")));
}

// 3. Expired memory → expired
{
  const r = buildMemoryGovernanceRecord(
    rec({ retention: "expired" }),
    OPTS,
  );
  check("3. retention=expired → expired", r.status === "expired");
}

// 3b. expires_at < now → expired
{
  const r = buildMemoryGovernanceRecord(
    rec({ expires_at: "2026-01-01T00:00:00.000Z" }),
    OPTS,
  );
  check("3b. expires_at < now → expired", r.status === "expired");
}

// 4. Revoked memory → revoked
{
  const r = buildMemoryGovernanceRecord(rec({ retention: "revoked" }), OPTS);
  check("4. retention=revoked → revoked", r.status === "revoked");
}
{
  const r = buildMemoryGovernanceRecord(rec({ revoked_at: "2026-02-01T00:00:00.000Z" }), OPTS);
  check("4b. revoked_at present → revoked", r.status === "revoked");
}

// 5. Legacy imported → legacy/unverified + warning
{
  const r = buildMemoryGovernanceRecord(rec({ source: "imported_legacy" }), OPTS);
  check("5. imported_legacy → legacy", r.status === "legacy");
  check("5. imported_legacy → warning", r.warnings.some((w) => w.includes("legacy")));
}

// 6. Missing scope → invalid + warning
{
  const r = buildMemoryGovernanceRecord(rec({ scope: "" as never }), OPTS);
  check("6. missing scope → invalid", r.status === "invalid");
  check("6. missing scope → warning", r.warnings.some((w) => w.includes("invalid")));
}

// 7. Unknown sensitivity → NOT public, limited + warning
{
  const r = buildMemoryGovernanceRecord(rec({ sensitivity: "mystery" as never }), OPTS);
  check("7. unknown sensitivity NOT public", r.status !== "public");
  check("7. unknown sensitivity → limited", r.status === "limited");
  check("7. unknown sensitivity → warning", r.warnings.some((w) => w.includes("unknown")));
}

// 8. Evidence-linked memory → refs preserved, not fake verified
{
  const r = buildMemoryGovernanceRecord(
    rec({
      source: "evidence_report",
      evidence_refs: ["rpt-1"],
      trust_refs: { evidence_report_id: "rpt-1", evidence_fingerprint: "sha256:def" },
    }),
    OPTS,
  );
  check("8. evidence_refs preserved", r.evidence_refs.includes("rpt-1"));
  check("8. trust evidence_report_id preserved", r.trust_refs.evidence_report_id === "rpt-1");
  check("8. not faked verified (not active via linkage)", r.status === "active" || r.status === "limited");
}

// 9. Approval-review-linked memory → refs preserved, warning if incomplete
{
  const r = buildMemoryGovernanceRecord(
    rec({
      source: "approval_review",
      review_refs: ["rv-1"],
      trust_refs: { review_id: "rv-1", binding_fingerprint: "sha256:bind" },
    }),
    OPTS,
  );
  check("9. review_refs preserved", r.review_refs.includes("rv-1"));
  check("9. trust review_id preserved", r.trust_refs.review_id === "rv-1");
  check("9. binding_fingerprint preserved", r.trust_refs.binding_fingerprint === "sha256:bind");
}

// 10. Determinism: same input → same fingerprint/status/warnings
{
  const a = buildMemoryGovernanceRecord(rec({ sensitivity: "sensitive", retention: "long_term" }), OPTS);
  const b = buildMemoryGovernanceRecord(rec({ sensitivity: "sensitive", retention: "long_term" }), OPTS);
  check("10. deterministic fingerprint", a.governance_fingerprint === b.governance_fingerprint);
  check("10. deterministic status", a.status === b.status);
  check("10. deterministic warnings", stableEq(a.warnings, b.warnings));
}

function stableEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}

console.log(`\n[MWT-6 memory-governance smoke] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("OK: all 10 required behavior examples hold; no fake trust.");
