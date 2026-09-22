/**
 * Distillation-on-ingest (RFC-001 Phase 1 — the "Memory accumulates from use" wire).
 *
 * `distilTurn` (L0 rule-based, zero LLM calls) already extracts explicit memory
 * signals from a user turn. This module turns that into a *persisted* memory
 * entry, with two production-hardening fixes over the naive inline call:
 *
 *   1. DEDUP — the same explicit instruction repeated across turns must not
 *      create duplicate rows (memory bloat / retrieval noise). We probe
 *      `existsByContent` before `create`.
 *   2. FAIL-OPEN — any error is swallowed; distillation is an enhancement,
 *      never a dependency of the reply.
 *
 * Only USER turns are fed here (explicit signals like "记住…" / "以后都…" /
 * "我喜欢…"). The distilled entry defaults to sensitivity `unknown` (ADR-004
 * B1), so it reaches local/Manager views but is held out of the cloud Worker
 * until the user reviews it — safe by construction.
 *
 * Wired from `api/chat.ts` right after the raw user turn is retained.
 */

import {
  distilTurn,
  partitionByConfidence,
  toMemoryEntryInput,
} from "./distiller.js";
import { MemoryEntryRepo } from "../../db/repositories.js";
import { memoryDistilledEntries } from "../../metrics/prometheus.js";

/**
 * Distil a single user turn and persist any extracted memory entries.
 *
 * @returns the number of NEW entries actually persisted (0 if no signal or all
 *          duplicates / disabled).
 */
export async function distillTurnToMemory(
  userId: string,
  text: string,
  provenanceRef?: string
): Promise<number> {
  if (process.env.TRUSTOS_MEMORY_DISTILL === "0") return 0;
  if (!userId || !text?.trim()) return 0;

  const distilled = distilTurn(text);
  if (distilled.length === 0) return 0;

  // Observability: count every rule that fired (active or not).
  for (const entry of distilled) memoryDistilledEntries.inc({ rule: entry.rule });

  // High-confidence entries activate immediately. Low-confidence ones are held
  // for user review rather than dropped: `toMemoryEntryInput` stamps them with
  // `status:pending`, and the injector skips pending entries (see injector.ts),
  // so nothing unconfirmed can reach a prompt until the user confirms it in the
  // MemoryGovernanceSurface pending queue. This closes the Memory stickiness
  // loop end-to-end (RFC-001 Phase 1 + ADR-004 B0 governance).
  const { active, pending } = partitionByConfidence(distilled);
  if (active.length === 0 && pending.length === 0) return 0;

  let created = 0;
  // Dedup applies across both partitions: if the same content already exists
  // (active or pending) we skip, so a re-distilled signal never re-pends an
  // already-active memory.
  for (const entry of [...active, ...pending]) {
    try {
      const input = toMemoryEntryInput(entry, userId, provenanceRef);
      if (await MemoryEntryRepo.existsByContent(userId, input.content)) continue;
      await MemoryEntryRepo.create(input);
      created++;
    } catch {
      // fail-open: never break the turn
    }
  }
  return created;
}
