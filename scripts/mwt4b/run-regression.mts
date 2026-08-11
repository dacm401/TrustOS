// MWT-4B regression — deterministic, privacy, integrity-shape, ordering.
//
// Tests the synchronous, framework-free core buildTaskEvidenceExportSync.
// The async integrity seal (Web Crypto) is exercised in the browser; here we
// assert the deterministic artifact body + shape that the seal binds to.
// Run: npx tsx scripts/mwt4b/run-regression.mts

import {
  buildTaskEvidenceExportSync,
  EVIDENCE_EXPORT_SCHEMA_VERSION,
  type ExportEventLike,
} from "../../frontend/src/lib/evidence-export.js";

let pass = 0;
let fail = 0;
const fails: string[] = [];

function check(name: string, cond: boolean): void {
  if (cond) {
    pass++;
    process.stdout.write(`  ✅ ${name}\n`);
  } else {
    fail++;
    fails.push(name);
    process.stdout.write(`  ❌ ${name}\n`);
  }
}

const FIXED_AT = "2026-08-10T00:00:00.000Z";
const evA: ExportEventLike = {
  event_id: "ev-a",
  event_type: "model_call",
  timestamp: "2026-08-10T00:02:00.000Z",
  model: "deepseek/DeepSeek-V4-Flash",
  decision: "allow",
  event_hash: "abc",
  input_hash: "in1",
  output_hash: "out1",
};
const evB: ExportEventLike = {
  event_id: "ev-b",
  event_type: "tool_call",
  timestamp: "2026-08-10T00:01:00.000Z",
  decision: "deny",
};

// R1: deterministic — same input + pinned timestamp → identical JSON.
const a1 = buildTaskEvidenceExportSync([evA, evB], "task-1", FIXED_AT);
const a2 = buildTaskEvidenceExportSync([evB, evA], "task-1", FIXED_AT);
check("R1: deterministic given pinned timestamp", JSON.stringify(a1) === JSON.stringify(a2));

// R2: stable ordering by timestamp ASC.
check("R2: events ordered by timestamp ASC", a1.timeline[0].event_id === "ev-b");
check("R2: second event is ev-a", a1.timeline[1].event_id === "ev-a");

// R3: schema version + export_type.
check("R3: schema_version mwt4b.export.v0", a1.schema_version === EVIDENCE_EXPORT_SCHEMA_VERSION);
check("R3: export_type fixed", a1.export_type === "client_generated_unsigned_task_evidence_snapshot");

// R4: trust_boundary flags (unsigned, no attestation, not system of record).
check("R4: trust_boundary.signed=false", a1.trust_boundary.signed === false);
check("R4: trust_boundary.attestation=false", a1.trust_boundary.attestation === false);
check("R4: trust_boundary.system_of_record=false", a1.trust_boundary.system_of_record === false);
check("R4: trust_boundary.generated_by=client", a1.trust_boundary.generated_by === "client");

// R5: metadata + summary counts.
check("R5: task_id propagated", a1.task_id === "task-1");
check("R5: generated_at declared", a1.generated_at === FIXED_AT);
check("R5: event_count correct", a1.summary.event_count === 2);
check("R5: allow_count=1", a1.summary.allow_count === 1);
check("R5: deny_count=1", a1.summary.deny_count === 1);

// R6: pass-through hashes (never recomputed).
check("R6: hashes pass-through event_hash", a1.hashes[1].event_hash === "abc");
check("R6: hashes pass-through input/output", a1.hashes[1].input_hash === "in1" && a1.hashes[1].output_hash === "out1");
check("R6: missing hash not fabricated", a1.hashes[0].event_hash === undefined);

// R7: exclusions declared (privacy contract).
const exFields = new Set(a1.exclusions.map((e) => e.field));
check("R7: raw_prompt excluded", exFields.has("raw_prompt"));
check("R7: raw_output excluded", exFields.has("raw_output"));
check("R7: api_key excluded", exFields.has("api_key"));

// R8: privacy — no raw fields in timeline.
const timelineKeys = new Set(a1.timeline.flatMap((t) => Object.keys(t)));
check("R8: timeline has no raw_prompt/output field", !timelineKeys.has("raw_prompt") && !timelineKeys.has("raw_output"));

// R9: empty input → empty artifact, still valid shape.
const aEmpty = buildTaskEvidenceExportSync([], "task-x", FIXED_AT);
check("R9: empty events → event_count 0", aEmpty.summary.event_count === 0);
check("R9: empty task_id honored", aEmpty.task_id === "task-x");
check("R9: empty timeline/hashes arrays", aEmpty.timeline.length === 0 && aEmpty.hashes.length === 0);

// R10: single event deterministic.
const aSingle = buildTaskEvidenceExportSync([evA], "task-1", FIXED_AT);
check("R10: single event summary count=1", aSingle.summary.event_count === 1);

process.stdout.write(`\nMWT-4B Regression: ${pass} passed, ${fail} failed\n`);
if (fail > 0) {
  process.stdout.write(`Failed: ${fails.join(", ")}\n`);
  process.exit(1);
}
process.exit(0);
