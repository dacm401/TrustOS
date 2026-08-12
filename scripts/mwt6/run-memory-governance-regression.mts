// MWT-6 — Memory Governance regression: exhaustive status matrix + honesty invariants.
//
// Asserts the single contract that defines MWT-6 honesty:
//   - expired / revoked are NEVER active
//   - unknown / missing sensitivity is NEVER public
//   - missing scope is invalid (never silently active)
//   - legacy source is legacy/unverified (never active-as-verified)
//   - evaluate(build(x)) is symmetric with build(x)
//   - deterministic across injected now/hash

import {
  buildMemoryGovernanceRecord,
  evaluateMemoryGovernance,
} from "../../src/services/mwt6/memory-governance";
import type {
  MemoryGovernanceInput,
  MemoryScope,
  MemorySource,
  MemoryRetention,
  MemorySensitivity,
} from "../../src/services/mwt6/memory-governance-types";

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

const scopes: MemoryScope[] = ["user", "session", "task", "project", "system", "bogus"];
const sources: MemorySource[] = [
  "user_input",
  "assistant_output",
  "task_result",
  "evidence_report",
  "approval_review",
  "system_policy",
  "imported_legacy",
  "bogus",
];
const retentions: MemoryRetention[] = [
  "ephemeral",
  "session",
  "project",
  "long_term",
  "revoked",
  "expired",
  "bogus",
];
const sensitivities: MemorySensitivity[] = [
  "public",
  "internal",
  "sensitive",
  "restricted",
  "unknown",
  "bogus",
];

function base(over: Partial<MemoryGovernanceInput>): MemoryGovernanceInput {
  return {
    memory_id: "mem-x",
    content_digest: "sha256:abc",
    scope: "task",
    source: "task_result",
    created_at: "2026-08-01T00:00:00.000Z",
    created_by: "user-1",
    retention: "project",
    sensitivity: "internal",
    ...over,
  };
}

// ── Exhaustive matrix ──────────────────────────────────────────────────────────
for (const scope of scopes) {
  for (const source of sources) {
    for (const retention of retentions) {
      for (const sensitivity of sensitivities) {
        const r = buildMemoryGovernanceRecord(
          base({ scope, source, retention, sensitivity }),
          OPTS,
        );
        // Honesty invariants
        if (r.status === "active") {
          check(`active requires known scope (${scope})`, scope !== "bogus" && scope !== "");
          check(`active requires not revoked (${retention})`, retention !== "revoked" && retention !== "expired");
          check(`active requires not legacy source (${source})`, source !== "imported_legacy");
          check(`active requires not sensitive/restricted (${sensitivity})`, sensitivity !== "sensitive" && sensitivity !== "restricted");
          check(`active requires not unknown sensitivity (${sensitivity})`, sensitivity !== "unknown" && sensitivity !== "bogus");
        }
        if (retention === "revoked" || retention === "expired") {
          check(`revoked/expired never active (${retention})`, r.status !== "active");
        }
        if (scope === "bogus" || scope === "") {
          check(`bad scope → invalid (${scope})`, r.status === "invalid");
        }
        if (sensitivity === "unknown" || sensitivity === "bogus") {
          check(`unknown sensitivity never public (${sensitivity})`, r.status !== "public");
        }
        if (
          source === "imported_legacy" &&
          scope !== "bogus" &&
          scope !== "" &&
          retention !== "revoked" &&
          retention !== "expired"
        ) {
          check(`legacy source → legacy/unverified (${r.status})`, r.status === "legacy" || r.status === "unverified");
        }
      }
    }
  }
}

// ── evaluate() symmetry ────────────────────────────────────────────────────────
{
  const input = base({ sensitivity: "sensitive", retention: "long_term", source: "approval_review", review_refs: ["rv-9"], trust_refs: { review_id: "rv-9" } });
  const built = buildMemoryGovernanceRecord(input, OPTS);
  const evaluated = evaluateMemoryGovernance(built, OPTS);
  check("evaluate symmetric fingerprint", built.governance_fingerprint === evaluated.governance_fingerprint);
  check("evaluate symmetric status", built.status === evaluated.status);
  check("evaluate symmetric warnings", JSON.stringify(built.warnings) === JSON.stringify(evaluated.warnings));
}

// ── Determinism across re-invocation ───────────────────────────────────────────
{
  const input = base({ sensitivity: "restricted", retention: "project" });
  const a = buildMemoryGovernanceRecord(input, OPTS);
  const b = buildMemoryGovernanceRecord(input, OPTS);
  check("deterministic fingerprint repeat", a.governance_fingerprint === b.governance_fingerprint);
  check("deterministic warnings order", JSON.stringify(a.warnings) === JSON.stringify(b.warnings));
}

// ── Malformed trust ref → warning, not faked ───────────────────────────────────
{
  const r = buildMemoryGovernanceRecord(
    base({ trust_refs: { evidence_report_id: "" as never } }),
    OPTS,
  );
  check("malformed trust ref → warning", r.warnings.some((w) => w.includes("malformed")));
}

console.log(`\n[MWT-6 memory-governance regression] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("OK: exhaustive honesty matrix + symmetry + determinism hold.");
