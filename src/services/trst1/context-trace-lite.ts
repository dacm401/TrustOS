/**
 * TRST-1 Context Trace Lite
 *
 * Extracts per-message metadata from an OpenAI-compatible messages array.
 * Stores ONLY metadata (role, approx token count, content hash).
 * NEVER stores raw prompt content in the event log.
 * NEVER performs DLP detection.
 */

import { createHash } from "node:crypto";
import type { ContextBlockMeta } from "./event-envelope.js";

// ── Approximate token estimation (character-based fallback when tiktoken is heavy) ──
// Using ~4 chars per token as a rough English estimate.
// For production, tiktoken would be more accurate; this is Lite by design.

const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokens(text: unknown): number {
  if (typeof text !== "string") {
    if (typeof text === "object" && text !== null) {
      text = JSON.stringify(text);
    } else {
      return 0;
    }
  }
  return Math.max(1, Math.ceil((text as string).length / CHARS_PER_TOKEN_ESTIMATE));
}

function hashContent(content: unknown): string {
  const normalized =
    typeof content === "string" ? content : JSON.stringify(content ?? "");
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

// ── OpenAI Message Shape ────────────────────────────────────────────────────

interface ChatMessage {
  role: string;
  content?: string | unknown[] | null;
  name?: string;
  [key: string]: unknown;
}

/**
 * Extract context block metadata from an array of OpenAI-compatible messages.
 * Each message becomes one ContextBlockMeta.
 *
 * Privacy flags are always empty — TRST-1 does not perform DLP detection.
 */
export function extractContextBlocks(
  messages: ChatMessage[] | undefined,
): { blocks: ContextBlockMeta[]; totalApproxTokens: number } {
  if (!messages || !Array.isArray(messages)) {
    return { blocks: [], totalApproxTokens: 0 };
  }

  const blocks: ContextBlockMeta[] = [];
  let totalTokens = 0;

  for (const msg of messages) {
    if (!msg || typeof msg !== "object") continue;

    const role = msg.role ?? "unknown";
    const content = msg.content ?? "";
    const tokens = estimateTokens(content);

    const block: ContextBlockMeta = {
      block_id: `ctx_${role}_${blocks.length}`,
      role,
      source_type: "chat_message",
      approx_tokens: tokens,
      content_hash: hashContent(content),
      privacy_flags: [], // TRST-1: no DLP
    };

    blocks.push(block);
    totalTokens += tokens;
  }

  return { blocks, totalApproxTokens: totalTokens };
}
