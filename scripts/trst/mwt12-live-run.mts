// MWT-12 — Live Operator Run (autonomous script, Boss-approved)
//
// Purpose: execute the REAL Manager Loop v0 product path against a LIVE
// environment (running Postgres + TrustOS Gateway) and capture authentic
// `[LIV]` evidence. This is the operator-only task PM previously reserved;
// Boss has authorized the agent to run it autonomously.
//
// HONESTY RULES (non-negotiable):
//   - If live services are NOT running, report ENV_BLOCKED and STOP.
//   - NEVER fabricate [LIV] evidence, model calls, or reviewer feedback.
//   - output_hash / event hashes are only written if genuinely produced.
//   - This script does NOT install PostgreSQL or start the Gateway. That is
//     environment provisioning, escalated to Boss separately.
//
// Run: npx tsx scripts/trst/mwt12-live-run.mts
// Env: requires .env with DATABASE_URL + OPENAI_API_KEY + TRUSTOS_GATEWAY_URL

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inspectLiveEnv } from "../trst4h-iii/live-env-diagnostics.mts";
import net from "node:net";

// Manual .env loader (project convention: no dotenv package).
// Loads keys into process.env so inspectLiveEnv sees real config.
function loadDotEnv(): void {
  const p = join(process.cwd(), ".env");
  if (!existsSync(p)) return;
  const text = readFileSync(p, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = val;
  }
}

const ROOT = process.cwd();
const EVIDENCE_DIR = join(ROOT, ".trustos", "live");
const EVIDENCE_FILE = join(EVIDENCE_DIR, "mwt12-evidence.jsonl");

interface ProbeResult {
  host: string;
  port: number;
  reachable: boolean;
  ms: number;
}

function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const start = Date.now();
    const sock = new net.Socket();
    let done = false;
    const finish = (reachable: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve({ host, port, reachable, ms: Date.now() - start });
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

function emit(level: "INFO" | "BLOCK" | "LIV" | "FAIL", msg: string, extra?: unknown): void {
  const line = {
    tag: "MWT-12",
    kind: level,
    ts: new Date().toISOString(),
    msg,
    ...(extra !== undefined ? { extra } : {}),
  };
  // Live evidence rows are persisted separately and tagged [LIV].
  if (level === "LIV") {
    if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
    appendFileSync(EVIDENCE_FILE, JSON.stringify(line) + "\n");
  }
  const prefix = level === "BLOCK" ? "⛔" : level === "FAIL" ? "❌" : level === "LIV" ? "🔴[LIV]" : "ℹ️";
  console.log(`${prefix} ${msg}`);
}

async function main(): Promise<void> {
  console.log("=== MWT-12 LIVE OPERATOR RUN ===");
  console.log(`baseline: a3d34c2 (Manager Loop v0 SEALED)`);
  loadDotEnv();

  // 1. Config preflight (offline, no socket).
  const env = inspectLiveEnv({ databaseRequired: true, gatewayRequired: true });
  emit("INFO", `config preflight: ${env.summary}`);
  if (!env.ready_to_run) {
    emit("BLOCK", "ENV_BLOCKED — live config missing, cannot run MWT-12", env);
    process.exit(2);
  }

  // 2. Real TCP probe of live services (short timeout).
  // Manager Loop v0 live surface is the main backend (BACKEND_PORT), NOT the
  // optional TRST-2 upstream gateway (TRUSTOS_GATEWAY_URL). Probe backend.
  const backendPort = Number(process.env.BACKEND_PORT) || 3001;
  const pgHost = "localhost";
  const pgPort = 5432;
  const [pg, be] = await Promise.all([
    tcpProbe(pgHost, pgPort),
    tcpProbe("localhost", backendPort),
  ]);
  emit("INFO", `postgres(${pgHost}:${pgPort}) reachable=${pg.reachable} (${pg.ms}ms)`);
  emit("INFO", `backend(localhost:${backendPort}) reachable=${be.reachable} (${be.ms}ms)`);

  if (!pg.reachable || !be.reachable) {
    emit(
      "BLOCK",
      "ENV_BLOCKED — live services not running. Postgres and/or Backend are down. " +
        "Agent does NOT install/start them automatically; escalate to Boss for provisioning.",
      { postgres: pg, backend: be },
    );
    process.exit(2);
  }

  // 3. Services are LIVE. Run the REAL Manager Loop v0 product path against the
  //    running backend, capturing authentic [LIV] evidence for each step.
  emit("LIV", "live services confirmed UP — executing real Manager Loop v0 path");

  const BASE = `http://localhost:${backendPort}`;
  const UID = process.env.MWT12_USER || "mwt12-live-operator";
  const headers = { "Content-Type": "application/json", "X-User-Id": UID };

  async function call(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: any }> {
    const res = await fetch(BASE + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
    return { status: res.status, json };
  }

  // Step 1 — create conversation
  const conv = await call("POST", "/v1/manager-conversations", {
    title: "MWT-12 live run",
    initialMessage: "live operator run",
  });
  emit("LIV", `step1 createConversation -> HTTP ${conv.status}`, conv.json);
  const conversationId = conv.json?.conversation?.id;
  if (!conversationId || conv.status >= 400) {
    emit("FAIL", "MWT-12 live run stopped at step1 (conversation create failed)", conv.json);
    process.exit(1);
  }

  // Step 2 — create delegation contract (draft)
  const contract = await call("POST", `/v1/manager-conversations/${conversationId}/contracts`, {
    title: "MWT-12 live delegation",
    objective: "summarize the live run result",
    intended_worker: "local-harness",
    input_summary: "source=mwt12",
    constraints: "mode=deterministic_local",
    expected_output: "summary text",
    status: "draft",
  });
  emit("LIV", `step2 createContract -> HTTP ${contract.status}`, contract.json);
  const contractId = contract.json?.contract?.contract_id;
  if (!contractId || contract.status >= 400) {
    emit("FAIL", "MWT-12 live run stopped at step2 (contract create failed)", contract.json);
    process.exit(1);
  }

  // Step 3 — approve contract (draft -> ready_for_review -> approved)
  await call("POST", `/v1/manager-conversations/${conversationId}/contracts/${contractId}/status`, {
    status: "ready_for_review",
  });
  const approve = await call(
    "POST",
    `/v1/manager-conversations/${conversationId}/contracts/${contractId}/status`,
    { status: "approved" },
  );
  emit("LIV", `step3 approveContract -> HTTP ${approve.status}`, approve.json);
  if (approve.status >= 400) {
    emit("FAIL", "MWT-12 live run stopped at step3 (contract approve failed)", approve.json);
    process.exit(1);
  }

  // Step 4 — create controlled local execution attempt
  const attempt = await call(
    "POST",
    `/v1/manager-conversations/${conversationId}/contracts/${contractId}/attempts`,
    { mode: "deterministic_local" },
  );
  emit("LIV", `step4 createAttempt -> HTTP ${attempt.status}`, attempt.json);
  const attemptId = attempt.json?.attempt?.attempt_id;
  if (!attemptId || attempt.status >= 400) {
    emit("FAIL", "MWT-12 live run stopped at step4 (attempt create failed)", attempt.json);
    process.exit(1);
  }

  // Step 5 — internal manager review (approve contract)
  const review = await call("POST", `/v1/manager-conversations/${conversationId}/reviews`, {
    target_type: "delegation_contract",
    target_id: contractId,
    decision: "approve",
    reason: "MWT-12 live operator review",
    reviewer_label: "live-operator",
  });
  emit("LIV", `step5 createReview -> HTTP ${review.status}`, review.json);

  // Step 6 — verify persisted review via target lookup (real DB read-back)
  const reviewLookup = await call(
    "GET",
    `/v1/manager-conversations/${conversationId}/reviews/target/delegation_contract/${contractId}`,
  );
  emit("LIV", `step6 verifyReview -> HTTP ${reviewLookup.status}`, reviewLookup.json);

  emit(
    "LIV",
    "MWT-12 LIVE RUN COMPLETE — real Manager Loop v0 path executed against live Postgres + backend",
    { conversationId, contractId, attemptId, reviewCount: reviewLookup.json?.total ?? reviewLookup.json?.reviews?.length ?? 0 },
  );

  console.log("\n=== MWT-12 LIVE RUN COMPLETE ===");
  console.log(`evidence file: ${EVIDENCE_FILE} (real [LIV] events written)`);
}

main().catch((err) => {
  emit("FAIL", "MWT-12 live run crashed (real failure, not env blocker)", String(err));
  process.exit(1);
});
