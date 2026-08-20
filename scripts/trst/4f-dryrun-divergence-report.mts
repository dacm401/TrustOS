/**
 * TRST-4F — Dry-Run Divergence Report (go-live decision support).
 *
 * Reads the live Event Backbone (events.jsonl) and computes, for the dry-run
 * shadow window, how many calls WOULD have been blocked / held had enforcement
 * been in `live` mode. This is the evidence Boss needs before flipping
 * POLICY_ENFORCEMENT_MODE=live.
 *
 * 2026-08-20 (competitiveness-first re-plan): 4F is a competitive differentiator
 * (real DLP blocking). This script supports the *measured* go-live decision —
 * it never blocks, only reports.
 *
 * Usage:
 *   npx tsx scripts/trst/4f-dryrun-divergence-report.mts [--since <ISO>] [--min-divergence <pct>] [--json]
 *
 * Output:
 *   - divergence counts by decision / rule / data_type
 *   - would_block rate (% of total calls)
 *   - a GO / HOLD recommendation based on --min-divergence threshold
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const EVENTS_PATH = resolve(ROOT, ".trustos", "events.jsonl");

interface EnforcementEvent {
  event_type: string;
  timestamp: string;
  session_id?: string;
  decision?: string;
  rule_id?: string;
  enforcement_mode?: string;
  blocked?: string;
  data_type?: string;
  recipient?: string;
  signer_identity?: { user_id: string; public_key_fingerprint?: string };
}

function parseArgs(argv: string[]): { since?: string; minDivergence: number; json: boolean } {
  let since: string | undefined;
  let minDivergence = 2.0; // default: flag if >2% of calls would be blocked
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--since") since = argv[++i];
    else if (argv[i] === "--min-divergence") minDivergence = parseFloat(argv[++i]);
    else if (argv[i] === "--json") json = true;
  }
  return { since, minDivergence, json };
}

function loadEvents(): EnforcementEvent[] {
  if (!existsSync(EVENTS_PATH)) {
    return [];
  }
  const raw = readFileSync(EVENTS_PATH, "utf8");
  const out: EnforcementEvent[] = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const e = JSON.parse(t);
      if (e.event_type === "policy_enforcement") out.push(e as EnforcementEvent);
    } catch {
      /* skip malformed lines */
    }
  }
  return out;
}

function main(): void {
  const { since, minDivergence, json } = parseArgs(process.argv.slice(2));
  const all = loadEvents();

  const sinceTs = since ? Date.parse(since) : NaN;
  const events = all.filter((e) => Number.isNaN(sinceTs) || Date.parse(e.timestamp) >= sinceTs);

  const total = events.length;
  const deny = events.filter((e) => e.decision === "deny");
  const ask = events.filter((e) => e.decision === "ask_user");
  const allow = events.filter((e) => e.decision === "allow" || (e.decision !== "deny" && e.decision !== "ask_user"));

  const byRule = new Map<string, number>();
  const byDataType = new Map<string, number>();
  for (const e of deny) {
    byRule.set(e.rule_id ?? "none", (byRule.get(e.rule_id ?? "none") ?? 0) + 1);
    byDataType.set(e.data_type ?? "unknown", (byDataType.get(e.data_type ?? "unknown") ?? 0) + 1);
  }

  const wouldBlockRate = total > 0 ? (deny.length / total) * 100 : 0;
  const wouldAskRate = total > 0 ? (ask.length / total) * 100 : 0;
  const recommendation = wouldBlockRate <= minDivergence ? "GO" : "HOLD";

  const report = {
    generated_at: new Date().toISOString(),
    events_path: EVENTS_PATH,
    window: since ? { since } : { since: "all" },
    total_enforcement_events: total,
    dry_run_divergence: {
      would_block: deny.length,
      would_ask: ask.length,
      would_allow: allow.length,
      would_block_rate_pct: Number(wouldBlockRate.toFixed(2)),
      would_ask_rate_pct: Number(wouldAskRate.toFixed(2)),
    },
    by_rule: Object.fromEntries(byRule),
    by_data_type: Object.fromEntries(byDataType),
    threshold_min_divergence_pct: minDivergence,
    recommendation,
  };

  if (json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    process.stdout.write(`\n=== TRST-4F Dry-Run Divergence Report ===\n`);
    process.stdout.write(`Generated: ${report.generated_at}\n`);
    process.stdout.write(`Window: ${since ? since : "all events"}\n`);
    process.stdout.write(`Total enforcement events: ${total}\n\n`);
    process.stdout.write(`Would BLOCK (deny): ${deny.length} (${report.dry_run_divergence.would_block_rate_pct}%)\n`);
    process.stdout.write(`Would ASK   (ask_user): ${ask.length} (${report.dry_run_divergence.would_ask_rate_pct}%)\n`);
    process.stdout.write(`Would ALLOW: ${allow.length}\n\n`);
    if (byRule.size > 0) {
      process.stdout.write(`By rule:\n`);
      for (const [k, v] of byRule) process.stdout.write(`  ${k}: ${v}\n`);
    }
    if (byDataType.size > 0) {
      process.stdout.write(`By data_type:\n`);
      for (const [k, v] of byDataType) process.stdout.write(`  ${k}: ${v}\n`);
    }
    process.stdout.write(`\nThreshold (max acceptable block rate): ${minDivergence}%\n`);
    process.stdout.write(`RECOMMENDATION: ${recommendation}\n`);
    if (recommendation === "HOLD") {
      process.stdout.write(`  -> divergence above threshold; extend dry-run window or tune DEFAULT_POLICY_RULES.\n`);
    } else {
      process.stdout.write(`  -> safe to flip POLICY_ENFORCEMENT_MODE=live (see go-live checklist).\n`);
    }
    process.stdout.write(`\n`);
  }

  process.exit(recommendation === "GO" ? 0 : 1);
}

main();
