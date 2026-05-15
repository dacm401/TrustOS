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

const pad = (s, n) => String(s).padEnd(n, " ").slice(0, n);

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

// ── Ledger merge helper ─────────────────────────────────────────────────────

/**
 * 深度合并两个 ledger 对象。entries 数组以 source 为主（覆盖），其他字段浅合并。
 */
function mergeLedger(base, source) {
  if (!source) return base ?? {};
  if (!base) return source;
  const merged = { ...base, ...source };
  // entries 保留 source 的（通常 done 事件里的最完整）
  if (source.entries?.length) merged.entries = source.entries;
  return merged;
}

// ── Ledger summary formatter ────────────────────────────────────────────────

/**
 * 从 ledger 对象提取关键指标，打印格式化摘要表。
 * ledger 结构（来自 SSE event.ledger）：
 * {
 *   managerCalls, workerCalls, totalModelCalls,
 *   entries: [{ role, model, inputTokens, outputTokens,
 *               latencyMs, estimatedCostUsd, pricingKnown, pricingSource }],
 *   security: { sentArtifactContentToManagerRemote, sentArtifactContentToWorkerRemote,
 *               sentRawHistoryToWorkerRemote, sentRawMemoryToWorkerRemote,
 *               sensitiveMemoryWasSent, artifactContentBytesToWorker, ... },
 *   securityScope: { ... }   // 可能放在 securityScope 字段
 * }
 */
function printLedgerSummary(ledger) {
  if (!ledger) {
    console.log("  Ledger  : (not in SSE — check server log [CALL_LEDGER])");
    return;
  }

  const mc = ledger.managerCalls ?? "?";
  const wc = ledger.workerCalls ?? "?";
  const tc = ledger.totalModelCalls ?? "?";

  console.log(`  ┌─ Ledger ─────────────────────────────────────────────`);
  console.log(`  │  managerCalls=${mc}  workerCalls=${wc}  totalModelCalls=${tc}`);

  const entries = ledger.entries ?? [];
  if (entries.length > 0) {
    console.log(`  │  Entries:`);
    for (const e of entries) {
      const role = e.modelRole ?? e.role ?? "?";
      const model = e.model ?? "?";
      const inTk = e.inputTokens ?? "?";
      const outTk = e.outputTokens ?? "?";
      const ms = e.latencyMs ?? "?";
      const known = e.pricingKnown !== undefined ? String(e.pricingKnown) : "?";
      const cost = e.estimatedCostUsd != null
        ? `$${e.estimatedCostUsd.toFixed(6)}`
        : (e.estimatedCost != null ? `$${Number(e.estimatedCost).toFixed(6)}` : "null");
      const src = e.pricingSource ?? (known === "true" ? "configured" : "unknown");
      console.log(
        `  │    [${role}] ${model}  in=${inTk} out=${outTk} ms=${ms}  cost=${cost}  known=${known}(${src})`,
      );
    }
  } else {
    console.log(`  │  Entries: (empty)`);
  }

  // Security Scope — 从 ledger.security 或 ledger.securityScope 提取
  const sec = ledger.security ?? ledger.securityScope ?? null;
  if (sec && typeof sec === "object") {
    const fields = [
      ["artifactToManager",   sec.sentArtifactContentToManagerRemote],
      ["artifactToWorker",    sec.sentArtifactContentToWorkerRemote],
      ["rawHistoryToWorker",  sec.sentRawHistoryToWorkerRemote],
      ["rawMemoryToWorker",   sec.sentRawMemoryToWorkerRemote],
      ["sensitiveMemSent",     sec.sensitiveMemoryWasSent],
      ["artifactBytesWorker", sec.artifactContentBytesToWorker],
      ["remoteCtxManager",    sec.remoteContextBytesToManager],
      ["remoteCtxWorker",     sec.remoteContextBytesToWorker],
    ];
    const shown = fields.filter(([, v]) => v !== undefined && v !== null);
    if (shown.length > 0) {
      console.log(`  │  Security Scope:`);
      for (const [k, v] of shown) {
        console.log(`  │    ${k} = ${JSON.stringify(v)}`);
      }
    }
  }

  console.log(`  └─────────────────────────────────────────────────────`);
}

// ── Lineage tracker ──────────────────────────────────────────────────────────

const lineage = []; // [{ artifactId, revisionOf, msgIndex }]

// ── Send message (SSE) ────────────────────────────────────────────────────────

/**
 * 发送单条消息，返回 assistant 回复内容 + ledger 数据 + artifactId。
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
        artifactId = event.artifact_id ?? event.artifactId;
      }
      // 提取 ledger（从 meta 或 ledger 事件）
      if ((event.type === "meta" || event.type === "ledger" || event.type === "done") && event.ledger) {
        ledger = mergeLedger(ledger, event.ledger);
      }
      // 直接在 event 顶层嵌入 security 时也提取
      if ((event.type === "meta" || event.type === "done") && event.security) {
        if (!ledger) ledger = {};
        ledger.security = { ...(ledger.security ?? {}), ...event.security };
      }
      // securityScope 变体
      if ((event.type === "meta" || event.type === "done") && event.securityScope) {
        if (!ledger) ledger = {};
        ledger.securityScope = { ...(ledger.securityScope ?? {}), ...event.securityScope };
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

    // 打印格式化 ledger 摘要表
    printLedgerSummary(ledger);

    // 记录 lineage（用于追踪 revisionOf 链）
    if (artifactId) {
      const entry = { artifactId, revisionOf: ledger?.revisionOfArtifactId ?? null, msgIndex: i + 1 };
      lineage.push(entry);
      if (entry.revisionOf) {
        console.log(`  Lineage : revisionOf = ${entry.revisionOf}`);
      }
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
  console.log(`\nArtifact Lineage Chain:`);
  for (const entry of lineage) {
    const revOf = entry.revisionOf ?? "(new artifact)";
    console.log(`  MSG${entry.msgIndex}: artifact=${entry.artifactId ?? "?"}  revisionOf=${revOf}`);
  }

  console.log(`\nLedger Summary Table:`);
  console.log(`  ${pad("MSG",4)} ${pad("managerCalls",12)} ${pad("workerCalls",12)} ${pad("totalCalls",11)} ${pad("estCost",18)} ${pad("known",6)} ${pad("estSource",12)}`);
  console.log(`  ${"─".repeat(80)}`);

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const led = r.ledger;
    const mc  = led?.managerCalls    ?? "-";
    const wc  = led?.workerCalls     ?? "-";
    const tc  = led?.totalModelCalls ?? "-";
    const entries = led?.entries ?? [];
    // 取第一条 entry 的 cost 作为代表（通常只有一条 worker call）
    const firstEntry = entries[0];
    const cost = firstEntry
      ? (firstEntry.estimatedCostUsd != null
          ? `$${firstEntry.estimatedCostUsd.toFixed(6)}`
          : (firstEntry.estimatedCost != null
              ? `$${Number(firstEntry.estimatedCost).toFixed(6)}`
              : "null"))
      : "-";
    const known = firstEntry
      ? String(firstEntry.pricingKnown ?? "?")
      : "-";
    const src = firstEntry?.pricingSource ?? "-";

    console.log(
      `  ${pad(`MSG${i + 1}`, 4)} ${pad(String(mc), 12)} ${pad(String(wc), 12)} ${pad(String(tc), 11)} ${pad(cost, 18)} ${pad(known, 6)} ${pad(src, 12)}`,
    );
  }

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
