/**
 * Evidence Anchor — R4 红线重设（2026-08-19）
 *
 * 原 TRST-0.3 R4: "Tamper-evident, 非 tamper-proof"。
 * 重设：在保持零外部依赖的前提下，允许用户将本地证据链根哈希导出到
 * 自托管的不可变存储（WORM / 对象存储 / 区块链 / 纸质 QR），从而把
 * "tamper-evident" 升级为 "tamper-evident + user-anchored"。
 *
 * 设计原则（不违反 R6 不生产化护栏）：
 *   - 不引入任何第三方服务 / SDK / 网络调用。
 *   - 仅做本地聚合（Merkle root）与文件写出。
 *   - 外部锚定动作完全由用户掌控（导出后用户自行处置 anchor 文件）。
 *   - 原始证据事件仍只含 hash + 标签，raw payload 绝不落库。
 */

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { readAllEvents, getStorePath } from "../services/trst1/jsonl-event-store.js";
import type { TrstEventEnvelope } from "../services/trst1/event-envelope.js";

/**
 * 4E v0 (2026-08-20): attribution metadata for a governance action.
 * Local shape mirrors src/trust/policy-enforcement.ts#SignerIdentity to avoid
 * cross-layer coupling. fingerprint optional (no key store introduced).
 */
export interface SignerIdentity {
  user_id: string;
  public_key_fingerprint?: string;
}

export interface EvidenceAnchor {
  /** Merkle root of all event_hash in the store */
  root_hash: string;
  /** Number of events included in the root */
  event_count: number;
  /** ISO 8601 generation timestamp */
  generated_at: string;
  /** Source event log path (for audit traceability) */
  store_path: string | undefined;
  /** Hash algorithm identifier */
  algorithm: "sha256-merkle";
  /** 4E v0: who exported this anchor */
  signer_identity: SignerIdentity;
}

/**
 * Compute the Merkle root over a list of event hashes.
 *
 * Uses a simple pairwise SHA-256 Merkle tree:
 *   - 0 events  → throws (nothing to anchor)
 *   - 1 event   → root = that event's hash
 *   - N events  → hash pairs bottom-up; odd node duplicated
 *
 * @param events Ordered event envelopes (already sealed with event_hash)
 */
export function computeEvidenceRootHash(events: TrstEventEnvelope[]): string {
  if (events.length === 0) {
    throw new Error("[EVIDENCE-ANCHOR] No events to anchor");
  }

  let level = events.map((e) => {
    if (!e.event_hash) {
      throw new Error(`[EVIDENCE-ANCHOR] Event ${e.event_id} missing event_hash`);
    }
    return e.event_hash;
  });

  while (level.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left; // duplicate odd node
      next.push(createHash("sha256").update(left + right).digest("hex"));
    }
    level = next;
  }

  return level[0];
}

/**
 * Build an anchor object from the current event store.
 * @param signer 4E v0: who is exporting this anchor (defaults to "system")
 * @param events Optional pre-read events; defaults to reading the live store
 */
export function buildAnchor(signer?: SignerIdentity, events?: TrstEventEnvelope[]): EvidenceAnchor {
  const store = events ?? (readAllEvents() as unknown as TrstEventEnvelope[]);
  const root = computeEvidenceRootHash(store);
  return {
    root_hash: root,
    event_count: store.length,
    generated_at: new Date().toISOString(),
    store_path: getStorePath(),
    algorithm: "sha256-merkle",
    signer_identity: signer ?? { user_id: "system" },
  };
}

/**
 * Export the anchor to a user-specified path (self-hosted WORM target).
 *
 * Zero network calls — caller decides what to do with the file afterwards
 * (upload to immutable storage, print QR, commit to blockchain, etc.).
 *
 * @param outPath Absolute path for the anchor JSON file
 * @param signer  4E v0: who is exporting this anchor (defaults to "system")
 * @param events  Optional pre-read events; defaults to reading the live store
 * @returns The written EvidenceAnchor
 */
export function exportAnchorFile(
  outPath: string,
  signer?: SignerIdentity,
  events?: TrstEventEnvelope[],
): EvidenceAnchor {
  const anchor = buildAnchor(signer, events);
  writeFileSync(outPath, JSON.stringify(anchor, null, 2), "utf-8");
  return anchor;
}
