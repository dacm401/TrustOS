"use client";

// MWT-6-UI — Memory Governance Panel v0.
//
// Renders a MemoryGovernanceRecord (produced by the MWT-6 core evaluator) as
// an honest, human-readable governance view. No backend dependency: the record
// is passed in as a prop. No enforcement, no re-evaluation. Status tones come
// from memory-governance-status.ts (single source), so the SAME mapping tested
// by the smoke/regression scripts drives the colors.

import type { MemoryGovernanceRecord } from "@/types/memory-governance";
import {
  statusDisplay,
  sensitivityTone,
  sensitivityLabel,
  truncateFingerprint,
  toneClasses,
} from "./memory-governance-status";

function Chip({
  tone,
  children,
}: {
  tone: "positive" | "warning" | "danger" | "neutral";
  children: React.ReactNode;
}) {
  return (
    <span
      className={`inline-block text-xs font-medium px-2.5 py-1 rounded-lg border ${toneClasses(tone)}`}
    >
      {children}
    </span>
  );
}

function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-gray-50 last:border-0">
      <span className="text-xs text-gray-400 uppercase tracking-wide shrink-0">{label}</span>
      <span className={`text-sm text-gray-700 text-right ${mono ? "font-mono break-all" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function RefList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-lg border border-indigo-100 bg-indigo-50/40 px-4 py-2">
      <div className="text-xs font-semibold text-indigo-600 mb-1">{title}</div>
      <ul className="space-y-0.5">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-indigo-800 font-mono break-all">
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function MemoryGovernancePanel({
  record,
}: {
  record: MemoryGovernanceRecord;
}) {
  const status = statusDisplay(record.status);
  const refs = record.trust_refs;

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      {/* Header + status badge */}
      <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-lg">🧠</span>
          <div className="min-w-0">
            <h2 className="font-semibold text-gray-800 text-sm">Memory Governance</h2>
            <p className="text-xs text-gray-400 truncate" style={{ maxWidth: 220 }}>
              {record.memory_id}
            </p>
          </div>
        </div>
        <Chip tone={status.tone}>{status.label}</Chip>
      </div>

      {/* Body */}
      <div className="p-5 space-y-4">
        {/* Governance dimensions */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400 mr-1">Scope:</span>
          <Chip tone="neutral">{record.scope}</Chip>
          <span className="text-xs text-gray-400 mr-1 ml-2">Source:</span>
          <Chip tone="neutral">{record.source}</Chip>
          <span className="text-xs text-gray-400 mr-1 ml-2">Retention:</span>
          <Chip tone="neutral">{record.retention}</Chip>
          <span className="text-xs text-gray-400 mr-1 ml-2">Sensitivity:</span>
          <Chip tone={sensitivityTone(record.sensitivity)}>
            {sensitivityLabel(record.sensitivity)}
          </Chip>
        </div>

        {/* Key facts */}
        <div className="rounded-lg border border-gray-100 bg-gray-50/40 px-4 py-1">
          <Row label="Memory ID" value={record.memory_id} mono />
          <Row label="Content Digest" value={truncateFingerprint(record.content_digest)} mono />
          <Row label="Created By" value={record.created_by ?? "—"} mono />
          <Row label="Created At" value={record.created_at ?? "—"} mono />
          <Row label="Expires At" value={record.expires_at ?? "—"} mono />
          {record.revoked_at && <Row label="Revoked At" value={record.revoked_at} mono />}
          <Row
            label="Governance FP"
            value={truncateFingerprint(record.governance_fingerprint)}
            mono
          />
          <Row label="Evaluated At" value={record.evaluated_at ?? "—"} mono />
        </div>

        {/* Trust Spine refs */}
        <RefList
          title="Trust Spine Refs"
          items={[
            refs.evidence_report_id ? `evidence_report: ${refs.evidence_report_id}` : "",
            refs.evidence_fingerprint ? `evidence_fp: ${refs.evidence_fingerprint}` : "",
            refs.approval_id ? `approval: ${refs.approval_id}` : "",
            refs.binding_fingerprint ? `binding_fp: ${refs.binding_fingerprint}` : "",
            refs.review_id ? `review: ${refs.review_id}` : "",
          ].filter(Boolean)}
        />

        {/* Warnings — always visible when present */}
        {record.warnings.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="text-xs font-semibold text-amber-700 mb-1.5">
              Warnings ({record.warnings.length})
            </div>
            <ul className="space-y-1">
              {record.warnings.map((w, i) => (
                <li key={i} className="text-xs text-amber-800 flex gap-1.5">
                  <span className="text-amber-500">•</span>
                  <span className="break-words">{w}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Honesty footer */}
        <div className="text-[11px] text-gray-400 border-t border-gray-50 pt-2">
          MWT-6 · Memory Governance (core evaluator). No enforcement, no backend
          dependency. Status rendered honestly — untrusted states are never shown as safe.
        </div>
      </div>
    </section>
  );
}
