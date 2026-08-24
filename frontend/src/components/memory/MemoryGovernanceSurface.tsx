"use client";

// MWT-6-UI — Memory Governance Surface v1.
//
// Renders the REAL MWT-6 governance output over the user's actual memory corpus
// (fetched from /v1/memory/governance, evaluated server-side by the MWT-6 core).
// This is the retention hook: memory is "alive" and shows its governance status
// (active / limited / expired / revoked / unverified / legacy / invalid) as it
// grows with use. Falls back to fixtures only on fetch error (honest degradation).

import { useEffect, useState } from "react";
import MemoryGovernancePanel from "./MemoryGovernancePanel";
import { allFixtures } from "./__fixtures__/memory-governance";
import {
  fetchMemoryGovernance,
  type MemoryGovernanceApiRecord,
} from "@/lib/api";
import type {
  MemoryGovernanceRecord,
  MemoryGovernanceStatus,
  MemoryScope,
  MemorySource,
  MemoryRetention,
  MemorySensitivity,
  TrustSpineRefs,
} from "@/types/memory-governance";

const DEV_USER = "dev-user";

function toFullRecord(r: MemoryGovernanceApiRecord): MemoryGovernanceRecord {
  const trust_refs: TrustSpineRefs = {};
  return {
    memory_id: r.memory_id,
    content_digest: r.memory_id,
    scope: r.scope as MemoryScope,
    source: r.source as MemorySource,
    created_at: r.created_at,
    created_by: DEV_USER,
    retention: r.retention as MemoryRetention,
    sensitivity: r.sensitivity as MemorySensitivity,
    expires_at: null,
    revoked_at: null,
    provenance_refs: [],
    evidence_refs: [],
    approval_refs: [],
    review_refs: [],
    trust_refs,
    note: null,
    status: r.status as MemoryGovernanceStatus,
    warnings: r.warnings ?? [],
    governance_fingerprint: r.governance_fingerprint,
    evaluated_at: r.evaluated_at,
  };
}

export default function MemoryGovernanceSurface() {
  const [records, setRecords] = useState<MemoryGovernanceRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMemoryGovernance(DEV_USER)
      .then((res) => {
        if (cancelled) return;
        setRecords(res.records.map(toFullRecord));
      })
      .catch((e: any) => {
        if (cancelled) return;
        setError(e?.message ?? "治理加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isLive = records !== null;
  const shown = isLive ? records! : allFixtures;

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="memory-governance-surface">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            🧠 Memory Governance
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            MWT-6 — Inspect memory scope, source, retention, sensitivity, status,
            warnings, and Trust Spine links.{" "}
            {isLive ? (
              <span className="text-emerald-600 font-medium">Live · {records!.length} governed entries</span>
            ) : (
              <span className="text-amber-600 font-medium">Fixtures (live load failed: {error})</span>
            )}
          </p>
        </div>

        <div className="space-y-4">
          {shown.map((record) => (
            <MemoryGovernancePanel key={record.memory_id} record={record} />
          ))}
        </div>

        {/* Honest status legend */}
        <div className="rounded-xl border p-4 text-xs" style={{
          backgroundColor: "var(--bg-surface)",
          borderColor: "var(--border-subtle)",
        }}>
          <div className="font-semibold mb-2" style={{ color: "var(--text-primary)" }}>
            Status Legend
          </div>
          <ul className="space-y-1" style={{ color: "var(--text-secondary)" }}>
            <li>
              <span className="text-emerald-600 font-medium">Active</span> — governed, usable.
            </li>
            <li>
              <span className="text-amber-600 font-medium">Limited</span> — usable but with
              caution (sensitive / unknown sensitivity).
            </li>
            <li>
              <span className="text-amber-600 font-medium">Expired / Legacy / Unverified</span> —
              not fully trusted.
            </li>
            <li>
              <span className="text-red-600 font-medium">Revoked / Invalid</span> — do not treat
              as active or safe.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
