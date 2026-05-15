#!/usr/bin/env node
/**
 * Sprint 60P-H2: UTF-8 E2E Chat Harness
 *
 * 用途：以 UTF-8 JSON 发送真实多轮对话，验证 Worker delegation / Ledger / Lineage / Security Scope。
 * 用法：node scripts/e2e-chat-utf8.mjs [--host http://localhost:3001] [--user dev-user] [--scenario artifact]
 *
 * 内置场景（--scenario artifact）：
 *   MSG1：帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。
 *   MSG2：把按钮改成蓝色。
 *   MSG3：再把标题改大一点。
 *   MSG4：再帮我写一个注册页。
 *
 * 输出：
 *   - 每条消息的 policyRoute / managerCalls / workerCalls / totalModelCalls / pricingKnown / estCost
 *   - [CALL_LEDGER] 日志行（从 SSE stream 中提取）
 *   - Lineage 链（artifact_A → artifact_B.revisionOf=A → artifact_C.revisionOf=B）
 *   - Security Scope 字段
 */

import { parseArgs } from "node:util";

// ── CLI args ──────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    host: { type: "string", default: "http://localhost:3001" },
    user: { type: "string", default: "dev-user" },
    session: { type: "string", default: `e2e-${Date.now()}` },
    scenario: { type: "string", default: "artifact" },
    sse: { type: "boolean", default: true },
    verbose: { type: "boolean", default: false },
  },
});

const BASE_URL = args.host;
const USER_ID = args.user;
const SESSION_ID = args.session;

// ── Scenarios ─────────────────────────────────────────────────────────────────

const SCENARIOS = {
  artifact: [
    "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。",
    "把按钮改成蓝色。",
    "再把标题改大一点。",
    "再帮我写一个注册页。",
  ],
  simple: [
    "你好，今天天气怎么样？",
    "Python 快速排序怎么写？",
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   msg: string;
 *   traceId?: string;
 *   policyRoute?: string;
 *   managerCalls?: number;
 *   workerCalls?: number;
 *   totalModelCalls?: number;
 *   estCost?: string | null;
 *   pricingKnown?: boolean;
 *   entries?: Array<{role:string; model:string; ms:number; inTk:number; outTk:number; cost:string|null; pricingKnown:boolean}>;
 *   security?: Record<string, unknown>;
 *   delegated?: boolean;
 *   totalMs?: number;
 *   rawLedger?: Record<string, unknown>;
 * }} LedgerResult
 */

// ── Send message (SSE) ────────────────────────────────────────────────────────

/**
 * 发送单条消息，返回 assistant 回复内容 + ledger 数据。
 * @param {string} message
 * @param {Array<{role:string; content:string}>} history
 * @returns {Promise<{ reply: string; ledger: LedgerResult | null; artifactId?: string }>}
 */
async function sendMessage(message, history) {
  const body = JSON.stringify({
    message,
    history,
    userId: USER_ID,
    sessionId: SESSION_ID,
    stream: true,
  });

  const resp = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "accept": "text/event-stream",
    },
    body,
  });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${await resp.text()}`);
  }

  const contentType = resp.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream");

  if (!isSSE) {
    // Non-streaming fallback
    const json = await resp.json();
    return { reply: json.reply ?? json.message ?? "", ledger: null };
  }

  // Parse SSE stream
  const decoder = new TextDecoder("utf-8");
  let replyChunks = [];
  let ledger = null;
  let artifactId = undefined;
  let taskId = undefined;

  const reader = resp.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // keep incomplete line

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const raw = line.slice(6).trim();
      if (!raw || raw === "[DONE]") continue;

      let event;
      try { event = JSON.parse(raw); } catch { continue; }

      if (event.type === "chunk" && event.content) {
        replyChunks.push(event.content);
      }
      if (event.type === "done") {
        if (event.task_id) taskId = event.task_id;
      }
      if (event.type === "artifact" || event.artifact_id) {
        artifactId = event.artifact_id;
      }
      // 提取 ledger（从 data 块或 chunk 里的 JSON 注释）
      if (event.type === "meta" && event.ledger) {
        ledger = event.ledger;
      }
    }
  }

  const reply = replyChunks.join("");

  // ledger 可能通过 console.log 输出到 server 日志，此处无法直接读取
  // 实际验证通过观察服务端日志的 [CALL_LEDGER] 行
  return { reply, ledger, artifactId: artifactId ?? taskId };
}

// ── Parse ledger from server log line ─────────────────────────────────────────

/**
 * 从一行日志字符串中提取 [CALL_LEDGER] JSON。
 * 仅供脚本内部辅助用，实际 E2E 验证需直接看服务端输出。
 */
function tryParseLedger(line) {
  const idx = line.indexOf('{"msg":"[CALL_LEDGER]');
  if (idx === -1) return null;
  try { return JSON.parse(line.slice(idx)); } catch { return null; }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const messages = SCENARIOS[args.scenario] ?? SCENARIOS.artifact;
  console.log(`\n${"=".repeat(70)}`);
  console.log(`TrustOS E2E Chat Harness (UTF-8)`);
  console.log(`Host    : ${BASE_URL}`);
  console.log(`User    : ${USER_ID}`);
  console.log(`Session : ${SESSION_ID}`);
  console.log(`Scenario: ${args.scenario} (${messages.length} messages)`);
  console.log("=".repeat(70));

  const history = [];
  const results = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log(`\n[MSG${i + 1}] ${msg}`);
    console.log("-".repeat(50));

    const t0 = Date.now();
    let result;
    try {
      result = await sendMessage(msg, [...history]);
    } catch (err) {
      console.error(`  ❌ Error: ${err.message}`);
      results.push({ msg, error: err.message });
      continue;
    }
    const totalMs = Date.now() - t0;

    const { reply, ledger, artifactId } = result;
    const preview = reply.slice(0, 120).replace(/\n/g, " ");
    console.log(`  Reply   : ${preview}${reply.length > 120 ? "..." : ""}`);
    console.log(`  TotalMs : ${totalMs}ms`);
    if (artifactId) console.log(`  ArtifactId/TaskId: ${artifactId}`);

    if (ledger) {
      console.log(`  Ledger  :`, JSON.stringify(ledger, null, 2));
    } else {
      console.log(`  Ledger  : (from server log — check [CALL_LEDGER] line in backend output)`);
    }

    // Build history for next turn
    history.push({ role: "user", content: msg });
    history.push({ role: "assistant", content: reply });

    results.push({
      msgIndex: i + 1,
      message: msg,
      reply: preview,
      totalMs,
      artifactId,
      ledger,
    });
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("E2E Summary");
  console.log("=".repeat(70));
  console.log(`Session ID: ${SESSION_ID}`);
  console.log(`\nVerification checklist (check server logs for [CALL_LEDGER]):\n`);
  console.log(`  MSG1: policyRoute=direct_create_artifact OR manager_llm_required→delegate`);
  console.log(`        workerCalls=1, artifact_A generated`);
  console.log(`  MSG2: policyRoute=direct_artifact_revision`);
  console.log(`        managerCalls=0, workerCalls=1, revisionOf=artifact_A`);
  console.log(`  MSG3: policyRoute=direct_artifact_revision`);
  console.log(`        managerCalls=0, workerCalls=1, revisionOf=artifact_B`);
  console.log(`  MSG4: policyRoute=direct_create_artifact`);
  console.log(`        managerCalls=0, workerCalls=1, revisionOfArtifactId=undefined`);
  console.log(`\n  Security (for MSG2, MSG3):`);
  console.log(`        sentArtifactContentToWorkerRemote=true`);
  console.log(`        sentArtifactContentToManagerRemote=false`);
  console.log(`        sentRawHistoryToWorkerRemote=false`);
  console.log(`\n  Pricing:`);
  console.log(`        pricingKnown=true (DeepSeek-V4-Flash now in pricing.ts)`);
  console.log(`        estCost should be a real number, NOT null or 0`);
  console.log("=".repeat(70));
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
