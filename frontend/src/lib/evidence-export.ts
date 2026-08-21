// MWT-4B — Frontend-only auditable evidence export (v0).
//
// Per MWT-4B-export-scope-spec.md (v0):
//   - assembled entirely in the browser from data the frontend already holds
//   - no backend endpoint, no new network call, no durable store
//   - unsigned: trust_boundary.signed = false
//   - no raw prompt/output; only projected fields + pass-through hashes
//   - hashes are pass-through only (from source GatewayEvent), never recomputed
//
// Determinism: stable ordering (timestamp ASC, tie-break event_id ASC) + canonical
// JSON. An integrity seal (sha256 via Web Crypto) binds the artifact content so a
// reviewer can detect post-export tampering of the snapshot file.

// Minimal structural type for the events the export consumes. Compatible with the
// frontend GatewayEvent shape, but declared locally so this module is importable in
// Node test scripts without pulling in the full frontend api module.
import type { GatewayEvent } from "@/lib/api";

/**
 * Structural type for the events the export consumes. Aliased to the frontend
 * GatewayEvent shape so TaskEvidenceView can pass GatewayEvent[] directly.
 */
export type ExportEventLike = GatewayEvent;

export const EVIDENCE_EXPORT_SCHEMA_VERSION = "mwt4b.export.v0";

export interface ExportedTimelineItem {
  event_id: string;
  event_type: string;
  timestamp: string;
  summary: string;
  decision?: string;
}

export interface ExportedHashItem {
  event_id: string;
  event_hash?: string;
  input_hash?: string;
  output_hash?: string;
}

export interface IntegritySeal {
  algorithm: "sha256";
  body_digest: string;
  note: "client-generated integrity seal over snapshot content; export is unsigned and not a system-of-record attestation";
}

export interface TaskEvidenceExportArtifact {
  schema_version: string;
  export_type: "client_generated_unsigned_task_evidence_snapshot";
  generated_at: string;
  task_id: string;
  trust_boundary: {
    generated_by: "client";
    signed: false;
    attestation: false;
    system_of_record: false;
  };
  summary: {
    event_count: number;
    allow_count: number;
    deny_count: number;
    unknown_decision_count: number;
  };
  timeline: ExportedTimelineItem[];
  hashes: ExportedHashItem[];
  exclusions: Array<{ field: string; reason: string }>;
  integrity_seal: IntegritySeal;
}

const EXCLUSIONS: Array<{ field: string; reason: string }> = [
  { field: "raw_prompt", reason: "privacy: raw content excluded by design" },
  { field: "raw_output", reason: "privacy: raw content excluded by design" },
  { field: "api_key", reason: "security: secrets never exported" },
  { field: "provider_raw_payload", reason: "privacy: full payloads excluded by design" },
];

function summarize(ev: ExportEventLike): string {
  if (typeof ev.model === "string") return `model call to ${ev.model}`;
  if (ev.agent_id) return `agent event from ${ev.agent_id}`;
  return ev.event_type;
}

function extractDecision(ev: ExportEventLike): string | undefined {
  const d = (ev as Record<string, unknown>).decision;
  return typeof d === "string" ? d : undefined;
}

/** Canonical stable JSON: sorted object keys, stable array order. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`);
  return `{${parts.join(",")}}`;
}

/**
 * Synchronous core: builds the artifact WITHOUT the crypto seal.
 * Deterministic given the same events + generatedAt.
 */
export function buildTaskEvidenceExportSync(
  events: ExportEventLike[],
  taskId: string,
  generatedAt: string,
): Omit<TaskEvidenceExportArtifact, "integrity_seal"> {

  const ordered = [...events]
    .slice()
    .sort((a, b) => {
      const ta = a.timestamp ?? "";
      const tb = b.timestamp ?? "";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return (a.event_id ?? "") < (b.event_id ?? "") ? -1 : 1;
    });

  let allow = 0;
  let deny = 0;
  let unknown = 0;
  const timeline: ExportedTimelineItem[] = [];
  const hashes: ExportedHashItem[] = [];

  for (const ev of ordered) {
    const decision = extractDecision(ev);
    if (decision === "allow") allow++;
    else if (decision === "deny") deny++;
    else if (decision) unknown++;
    else unknown++;

    timeline.push({
      event_id: ev.event_id,
      event_type: ev.event_type,
      timestamp: ev.timestamp,
      summary: summarize(ev),
      ...(decision ? { decision } : {}),
    });

    const h = ev as Record<string, unknown>;
    const item: ExportedHashItem = { event_id: ev.event_id };
    if (typeof h.event_hash === "string") item.event_hash = h.event_hash;
    if (typeof h.input_hash === "string") item.input_hash = h.input_hash;
    if (typeof h.output_hash === "string") item.output_hash = h.output_hash;
    hashes.push(item);
  }

  return {
    schema_version: EVIDENCE_EXPORT_SCHEMA_VERSION,
    export_type: "client_generated_unsigned_task_evidence_snapshot",
    generated_at: generatedAt,
    task_id: taskId,
    trust_boundary: {
      generated_by: "client",
      signed: false,
      attestation: false,
      system_of_record: false,
    },
    summary: {
      event_count: ordered.length,
      allow_count: allow,
      deny_count: deny,
      unknown_decision_count: unknown,
    },
    timeline,
    hashes,
    exclusions: EXCLUSIONS,
  };
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Full async builder: adds the integrity seal over the canonical artifact body.
 */
export async function buildTaskEvidenceExport(
  events: ExportEventLike[],
  taskId: string,
  generatedAt: string = new Date().toISOString(),
): Promise<TaskEvidenceExportArtifact> {
  const base = buildTaskEvidenceExportSync(events, taskId, generatedAt);
  const body = stableStringify({
    timeline: base.timeline,
    hashes: base.hashes,
    summary: base.summary,
    task_id: base.task_id,
    schema_version: base.schema_version,
  });
  const bodyDigest = await sha256Hex(body);
  return {
    ...base,
    integrity_seal: {
      algorithm: "sha256",
      body_digest: bodyDigest,
      note: "client-generated integrity seal over snapshot content; export is unsigned and not a system-of-record attestation",
    },
  };
}
