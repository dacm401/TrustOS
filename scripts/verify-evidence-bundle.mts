/**
 * Verify the server-side Evidence Bundle builder (2026-08-28).
 *
 * Run: npx tsx scripts/verify-evidence-bundle.mts
 *
 * Proves:
 *   1. Privacy  — no raw content survives into the bundle
 *   2. Honesty  — unsigned when no key, never fakes signed:true
 *   3. Signing  — identical bundle ⇒ identical digest (canonical JSON)
 *   4. Verify   — tampered bundle fails verification
 *   5. Chain    — chain status is reported in the bundle
 */

import {
  buildEvidenceBundle,
  verifyBundleSignature,
  EVIDENCE_SCHEMA_VERSION,
  type EvidenceBundle,
} from "../src/services/trst1/evidence-bundle-service.js";
import { sealEvent } from "../src/services/trst1/event-envelope.js";
import type { TrstEventEnvelope } from "../src/services/trst1/event-envelope.js";

/**
 * Build properly sealed + chained events.
 * Order matters: prev_hash must be set BEFORE sealing, because it is part of
 * the hashed payload (see jsonl-event-store.appendEvent).
 */
function makeChain(
  bases: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  let tail: string | null = null;
  for (const b of bases) {
    const sealed = sealEvent({
      ...b,
      prev_hash: tail,
    } as unknown as Omit<TrstEventEnvelope, "event_hash">);
    tail = sealed.event_hash;
    out.push(sealed as unknown as Record<string, unknown>);
  }
  return out;
}

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

/** Events deliberately carrying raw content that MUST NOT leak. */
const rawish = [
  {
    event_id: "e1", event_type: "model_call", timestamp: "2026-08-28T00:00:00.000Z",
    trace_id: "t1", session_id: "s1", run_id: "r1",
    agent_id: "a1", provider: "openai", model: "m1", status: "success",
    latency_ms: 10, token_count: 5, error_code: null,
    input_hash: "ih1", output_hash: "oh1", args_hash: null, result_hash: null,
    // ── forbidden fields (must NOT survive into the bundle) ──
    prompt: "SECRET PROMPT", response: "SECRET RESPONSE",
    content: "SECRET CONTENT", messages: [{ role: "user", content: "SECRET" }],
    api_key: "sk-SECRET", authorization: "Bearer SECRET",
  },
  {
    event_id: "e2", event_type: "model_call", timestamp: "2026-08-28T00:00:01.000Z",
    trace_id: "t1", session_id: "s1", run_id: "r1",
    agent_id: "a1", provider: "openai", model: "m1", status: "success",
    latency_ms: 20, token_count: 7, error_code: null,
    input_hash: "ih2", output_hash: "oh2", args_hash: null, result_hash: null,
    prompt: "SECRET PROMPT 2", response: "SECRET RESPONSE 2",
  },
];

// Properly sealed + chained (prev_hash set before sealing).
const events = makeChain(rawish);
const serialized = () => JSON.stringify(buildEvidenceBundle(events));

console.log("\n── 1. Privacy: no raw content in the bundle ─────────────");
const noKeyBundle = buildEvidenceBundle(events);
const json = JSON.stringify(noKeyBundle);
check("no 'SECRET' string anywhere", !json.includes("SECRET"));
check("raw_content_included === false", noKeyBundle.privacy.raw_content_included === false);
check(
  "forbidden key scan reports none in output",
  noKeyBundle.privacy.forbidden_keys_found.length === 0,
  noKeyBundle.privacy.forbidden_keys_found.join(","),
);
check("schema version v1", noKeyBundle.schema_version === EVIDENCE_SCHEMA_VERSION);
check("events preserved (2)", noKeyBundle.events.length === 2);
check("hashes preserved", noKeyBundle.events[1].hashes.event_hash === events[1].event_hash);
check(
  "prev_hash preserved (chain-aware)",
  noKeyBundle.events[1].hashes.prev_hash === events[0].event_hash,
);
check("genesis has prev_hash === null", noKeyBundle.events[0].hashes.prev_hash === null);

console.log("\n── 2. Honesty: unsigned when no key configured ──────────");
delete process.env.TRUSTOS_EVIDENCE_SIGNING_KEY;
const unsigned = buildEvidenceBundle(events);
check("signed === false", unsigned.signature.signed === false);
check("digest === null", unsigned.signature.digest === null);
check("explicit reason provided", !!unsigned.signature.reason, "missing reason");
check("verify() false when unsigned", verifyBundleSignature(unsigned) === false);

console.log("\n── 3. Signing: deterministic + canonical ────────────────");
process.env.TRUSTOS_EVIDENCE_SIGNING_KEY = "test-key-abc";
const s1 = buildEvidenceBundle(events);
check("signed === true", s1.signature.signed === true);
check("algorithm hmac-sha256", s1.signature.algorithm === "hmac-sha256");
check("digest present", !!s1.signature.digest);
// generated_at differs per build by design, so digests of two *independent*
// builds legitimately differ. What must hold is that a given bundle verifies
// deterministically (canonical JSON ⇒ stable re-derivation).
check("verification is deterministic", verifyBundleSignature(s1) === true && verifyBundleSignature(s1) === true);
// Canonical JSON: key order must not change the digest.
const reordered: EvidenceBundle = JSON.parse(
  JSON.stringify(
    Object.fromEntries(Object.entries(s1).reverse()),
  ),
) as EvidenceBundle;
check(
  "key-order independent (canonical JSON)",
  verifyBundleSignature(reordered) === true,
  "re-ordered top-level keys changed the digest",
);

console.log("\n── 4. Verification: tampering detected ──────────────────");
check("valid bundle verifies", verifyBundleSignature(s1) === true);

const tampered: EvidenceBundle = JSON.parse(JSON.stringify(s1));
tampered.events[0].hashes.event_hash = "HACKED";
check("tampered event → verify false", verifyBundleSignature(tampered) === false);

const dropped: EvidenceBundle = JSON.parse(JSON.stringify(s1));
dropped.events.pop();
check("deleted event → verify false", verifyBundleSignature(dropped) === false);

const wrongKey: EvidenceBundle = JSON.parse(JSON.stringify(s1));
process.env.TRUSTOS_EVIDENCE_SIGNING_KEY = "different-key";
check("different key → verify false", verifyBundleSignature(wrongKey) === false);
process.env.TRUSTOS_EVIDENCE_SIGNING_KEY = "test-key-abc";

console.log("\n── 5. Chain status reported in bundle ───────────────────");
check("chain.valid === true for intact chain", s1.chain.valid === true, JSON.stringify(s1.chain));

// Simulate DELETION: keep genesis + third event, drop the middle one.
const three = makeChain([...rawish, { ...rawish[1], event_id: "e3", timestamp: "2026-08-28T00:00:02.000Z" }]);
const afterDelete = [three[0], three[2]];
const deletedBundle = buildEvidenceBundle(afterDelete);
check(
  "deleted middle event → chain invalid",
  deletedBundle.chain.valid === false,
  JSON.stringify(deletedBundle.chain),
);
check(
  "reports prev_hash mismatch (deletion/reordering)",
  /prev_hash mismatch/.test(deletedBundle.chain.reason ?? ""),
  String(deletedBundle.chain.reason),
);

console.log("\n── 6. Assessment included ───────────────────────────────");
check("assessment present", !!s1.assessment);
check("runtime_effect === none (prove, not control)", s1.runtime_effect === "none");

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
