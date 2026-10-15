/**
 * Continuity Engine — Gateway-side LLM Decision Extraction
 *
 * The single most important service for the "decision graph" UX:
 * given a raw conversation (role/content messages), ask the agent's OWN
 * LLM (reused via the gateway's provider abstraction) to extract the
 * decision/branch nodes, then those are persisted as `decision` events on
 * the Event Backbone — exactly the same path every other mediated call uses.
 *
 * Design notes:
 *  - Extraction is a SEPARATE, callable service (POST /trst1/extract-decisions),
 *    NOT inlined into every chat turn. This keeps the hot path latency-free and
 *    lets the product trigger extraction on session-end / debounce / demand.
 *  - It reuses `forwardChatCompletion` — no new LLM client, no new capability.
 *  - Failures are non-fatal: a bad/empty extraction returns [] and never throws.
 *  - Decision content lives in dedicated `decision_*` fields (NOT `prompt` /
 *    `content` / `messages`, which the /events viewer strips). The graph reader
 *    consumes the JSONL directly.
 */

import { createEventId, type TrstEventEnvelope } from "./event-envelope.js";
import { forwardChatCompletion } from "./openai-compatible-forwarder.js";

/** A single extracted decision node. */
export interface ExtractedDecision {
  /** Short human label, <= ~12 chars. The tree node's headline. */
  keyword: string;
  /** The user's triggering statement/question (short). */
  prompt: string;
  /** The resolution / decision reached (short). */
  reply: string;
  /** Keyword of the decision this one branches from; null for the root. */
  parent_keyword: string | null;
  /** Keywords of other decisions this one answers or relates to (cross-link). */
  links: string[];
  /** Order index in the conversation (0-based). */
  seq: number;
}

export interface ExtractionTarget {
  baseUrl: string;
  apiKey: string;
  model: string;
}

const MAX_NODES = 40;

const SYSTEM_PROMPT = `你是一个「决策抽取器」。给定一段人与 AI 的对话，抽取其中的决策/分叉节点。
一个节点 = 一次「定了方向 / 否决了某选项 / 冻结或认栽某件事 / 用户提出一个分支性疑问并被回答」的时刻。

只输出一个 JSON 数组，不要任何解释或 markdown 代码块。每个元素：
{
  "keyword": string,        // 简短关键词，<=12个汉字，作为节点标题
  "prompt": string,         // 触发此决策的"用户"原话要点，<=40字
  "reply": string,          // 该决策/结论的要点，<=60字
  "parent_keyword": string|null, // 它从哪个已有节点的 keyword 分叉而来；根节点为 null
  "links": string[],        // 此节点回答或关联的其它节点 keyword 列表，可空
  "seq": number             // 在对话中的大致顺序（0起）
}
规则：
- 宁可少抽，不要编造。没有决策就不要输出。
- parent_keyword 必须引用数组中真实存在的另一个 keyword，否则用 null。
- 最多输出 ${MAX_NODES} 个节点。`;

function flattenContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => {
        if (typeof p === "string") return p;
        if (p && typeof p === "object") {
          const o = p as Record<string, unknown>;
          if (typeof o.text === "string") return o.text;
          if (o.type === "text" && typeof o.text === "string") return o.text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/** Robustly pull a JSON array out of an LLM response (strips code fences). */
function parseDecisionArray(raw: string): ExtractedDecision[] {
  let text = raw.trim();
  // strip ```json ... ``` fences if present
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end === -1 || end <= start) return [];
  try {
    const arr = JSON.parse(text.slice(start, end + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x === "object")
      .map((x) => {
        const o = x as Record<string, unknown>;
        return {
          keyword: String(o.keyword ?? "").slice(0, 24),
          prompt: String(o.prompt ?? "").slice(0, 200),
          reply: String(o.reply ?? "").slice(0, 300),
          parent_keyword:
            o.parent_keyword == null ? null : String(o.parent_keyword).slice(0, 24),
          links: Array.isArray(o.links)
            ? (o.links as unknown[]).map((l) => String(l)).slice(0, 10)
            : [],
          seq: typeof o.seq === "number" ? o.seq : 0,
        } satisfies ExtractedDecision;
      })
      .filter((d) => d.keyword.length > 0)
      .slice(0, MAX_NODES);
  } catch {
    return [];
  }
}

/**
 * Call the agent's LLM to extract decision nodes from a conversation.
 * Never throws — returns [] on any failure (network, parse, empty).
 */
export async function extractDecisions(
  target: ExtractionTarget,
  messages: Array<{ role: string; content?: unknown }>,
): Promise<ExtractedDecision[]> {
  const convo = messages
    .map((m) => `${m.role === "assistant" ? "AI" : "人"}: ${flattenContent(m.content)}`)
    .join("\n")
    .slice(0, 24000); // rough safety cap

  if (convo.trim().length === 0) return [];

  try {
    const res = await forwardChatCompletion(target.baseUrl, target.apiKey, {
      model: target.model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `对话内容：\n${convo}` },
      ],
      stream: false,
      temperature: 0.2,
    });

    if (res.status < 200 || res.status >= 300) return [];
    const body = res.body as { choices?: Array<{ message?: { content?: string } }> };
    const content = body?.choices?.[0]?.message?.content;
    if (!content) return [];
    return parseDecisionArray(content);
  } catch {
    return [];
  }
}

export interface DecisionEventMeta {
  model: string;
  provider: string;
}

/**
 * Convert an extracted decision into a `decision` Event Backbone envelope.
 * The same `persistEvent` path used by every other mediated call writes it.
 */
export function toDecisionEvent(
  d: ExtractedDecision,
  identity: {
    traceId: string;
    sessionId: string;
    runId: string;
    projectId: string;
    taskId: string | null;
    agentId: string;
    actorId: string;
  },
  meta: DecisionEventMeta,
): Omit<TrstEventEnvelope, "event_hash"> {
  return {
    event_id: createEventId(),
    event_type: "decision",
    timestamp: new Date().toISOString(),
    trace_id: identity.traceId,
    session_id: identity.sessionId,
    run_id: identity.runId,
    project_id: identity.projectId,
    task_id: identity.taskId,
    agent_id: identity.agentId,
    actor_id: identity.actorId,
    source: "gateway",
    resource_type: "model",
    model: meta.model,
    provider: meta.provider,
    // Continuity payload (read by the graph UI from JSONL; not in /events whitelist)
    decision_keyword: d.keyword,
    decision_prompt: d.prompt,
    decision_reply: d.reply,
    decision_parent: d.parent_keyword ?? null,
    decision_links: d.links,
    decision_seq: d.seq,
    latency_ms: 0,
    privacy_flags: [],
    status: "success",
  };
}
