// MWT-4B smoke — builder callable + artifact shape sanity (sync core).
// Run: npx tsx scripts/mwt4b/run-smoke.mts

import { buildTaskEvidenceExportSync, type ExportEventLike } from "../../frontend/src/lib/evidence-export.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean): void {
  if (cond) { pass++; process.stdout.write(`  ✅ ${name}\n`); }
  else { fail++; process.stdout.write(`  ❌ ${name}\n`); }
}

const ev: ExportEventLike = {
  event_id: "ev-smoke",
  event_type: "model_call",
  timestamp: "2026-08-10T00:00:00.000Z",
  model: "test-model",
  decision: "allow",
};

const art = buildTaskEvidenceExportSync([ev], "task-smoke", "2026-08-10T00:00:00.000Z");

check("S1: artifact has top-level fields",
  typeof art.schema_version === "string" &&
  art.export_type === "client_generated_unsigned_task_evidence_snapshot" &&
  typeof art.task_id === "string" &&
  Array.isArray(art.timeline) &&
  Array.isArray(art.hashes) &&
  Array.isArray(art.exclusions) &&
  typeof art.trust_boundary === "object");
check("S2: timeline length 1", art.timeline.length === 1);
check("S3: summary event_count 1", art.summary.event_count === 1);
check("S4: exclusions non-empty", art.exclusions.length > 0);
check("S5: trust_boundary unsigned", art.trust_boundary.signed === false);

process.stdout.write(`\nMWT-4B Smoke: ${pass} passed, ${fail} failed\n`);
if (fail > 0) process.exit(1);
process.exit(0);
