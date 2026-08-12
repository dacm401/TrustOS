"use client";

// MWT-6-UI — Memory Governance Surface v0.
//
// A self-contained view that renders the deterministic MWT-6 fixtures as a
// vertical stack of MemoryGovernancePanels. No backend, no route data — it
// imports the same fixtures used by the smoke/regression scripts, so what you
// see in dev matches what is asserted in tests.

import MemoryGovernancePanel from "./MemoryGovernancePanel";
import { allFixtures } from "./__fixtures__/memory-governance";

export default function MemoryGovernanceSurface() {
  return (
    <div className="h-full overflow-y-auto p-6" data-testid="memory-governance-surface">
      <div className="max-w-3xl mx-auto space-y-6">
        <div>
          <h1 className="text-xl font-semibold" style={{ color: "var(--text-primary)" }}>
            🧠 Memory Governance
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            MWT-6 — Inspect memory scope, source, retention, sensitivity, status,
            warnings, and Trust Spine links. Deterministic fixtures; no backend.
          </p>
        </div>

        <div className="space-y-4">
          {allFixtures.map((record) => (
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
