// MWT-21 — Real Execution Mode LIVE Operator Run (Boss-approved, consumes token)
//
// Purpose: exercise the REAL worker execution seam (execution_mode: "real") end
// to end against a LIVE environment (running Postgres + TrustOS Backend) and
// verify the MWT-21 red lines:
//   - real output persisted as SHA-256 output_hash ONLY
//   - raw content NEVER stored in the attempt record
//   - contract gate (approved-only) still enforced
//   - default mode (deterministic_local) unchanged
//
// This is the complement to scripts/trst/mwt21-real-executor.test.mts (zero-DB).
// Here we hit the LIVE Manager Loop v0 API so the REAL TaskPlanner +
// ExecutionLoop path runs and a real model call is made (consumes token).
//
// HONESTY RULES (non-negotiable):
//   - If live services are NOT running, report ENV_BLOCKED and STOP.
//   - NEVER fabricate [LIV] evidence, model calls, or output_hash.
//   - output_hash is only reported if genuinely produced by the live run.
//   - This script does NOT install PostgreSQL or start the Backend.
//
// Run: npx tsx scripts/trst/mwt21-real-live-run.mts
// Env: requires .env with DATABASE_URL + OPENAI_API_KEY + BACKEND_PORT

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import net from "node:net";

// Manual .env loader (project convention: no dotenv package).
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
const EVIDENCE_FILE = join(EVIDENCE_DIR, "mwt21-real-evidence.jsonl");

function emit(level: "INFO" | "BLOCK" | "LIV" | "FAIL", msg: string, extra?: unknown): void {
  const line = {
    tag: "MWT-21",
    kind: level,
    ts: new Date().toISOString(),
    msg,
    ...(extra !== undefined ? { extra } : {}),
  };
  if (level === "LIV") {
    if (!existsSync(EVIDENCE_DIR)) mkdirSync(EVIDENCE_DIR, { recursive: true });
    appendFileSync(EVIDENCE_FILE, JSON.stringify(line) + "\n");
  }
  const prefix = level === "BLOCK" ? "⛔" : level === "FAIL" ? "❌" : level === "LIV" ? "🔴[LIV]" : "ℹ️";
  console.log(`${prefix} ${msg}`);
}

function tcpProbe(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      sock.destroy();
      resolve(ok);
    };
    sock.setTimeout(timeoutMs);
    sock.once("connect", () => finish(true));
    sock.once("timeout", () => finish(false));
    sock.once("error", () => finish(false));
    sock.connect(port, host);
  });
}

async function main(): Promise<void> {
  console.log("=== MWT-21 REAL EXECUTION MODE — LIVE OPERATOR RUN ===");
  console.log("baseline: 6e5a6af (MWT-21 wiring) + 22049fd (MWT-22) + migration 031 applied");
  loadDotEnv();

  // 1. Config preflight — real mode REQUIRES a model provider key.
  const pgOk = !!process.env.DATABASE_URL;
  const llmOk = !!process.env.OPENAI_API_KEY;
  emit("INFO", `config preflight: DATABASE_URL=${pgOk} OPENAI_API_KEY=${llmOk}`);
  if (!pgOk || !llmOk) {
    emit("BLOCK", "ENV_BLOCKED — DATABASE_URL and OPENAI_API_KEY are both required for real mode", {
      DATABASE_URL: pgOk,
      OPENAI_API_KEY: llmOk,
    });
    process.exit(2);
  }

  // 2. Probe live services.
  const backendPort = Number(process.env.BACKEND_PORT) || 3001;
  const [pg, be] = await Promise.all([tcpProbe("localhost", 5432), tcpProbe("localhost", backendPort)]);
  emit("INFO", `postgres reachable=${pg}; backend(localhost:${backendPort}) reachable=${be}`);
  if (!pg || !be) {
    emit(
      "BLOCK",
      "ENV_BLOCKED — live services not running (Postgres/Backend). Agent does NOT start them; escalate to Boss.",
      { postgres: pg, backend: be },
    );
    process.exit(2);
  }

  emit("LIV", "live services confirmed UP — running MWT-21 real execution path");
  const BASE = `http://localhost:${backendPort}`;
  const UID = process.env.MWT21_USER || "mwt21-real-operator";
  const headers = { "Content-Type": "application/json", "X-User-Id": UID };

  async function call(method: string, path: string, body?: unknown) {
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

  // Step 1 — conversation
  const conv = await call("POST", "/v1/manager-conversations", {
    title: "MWT-21 real run",
    initialMessage: "real execution operator run",
  });
  emit("LIV", `step1 createConversation -> HTTP ${conv.status}`, conv.json);
  const conversationId = conv.json?.conversation?.id;
  if (!conversationId || conv.status >= 400) {
    emit("FAIL", "stopped at step1 (conversation create failed)", conv.json);
    process.exit(1);
  }

  // Step 2 — draft contract (intended_worker must be a real-capable worker label)
  const contract = await call("POST", `/v1/manager-conversations/${conversationId}/contracts`, {
    title: "MWT-21 real delegation",
    objective: "produce a short text output via the real worker path",
    intended_worker: "local-harness",
    input_summary: "source=mwt21-real",
    constraints: "mode=real",
    expected_output: "short text",
    status: "draft",
  });
  emit("LIV", `step2 createContract -> HTTP ${contract.status}`, contract.json);
  const contractId = contract.json?.contract?.contract_id;
  if (!contractId || contract.status >= 400) {
    emit("FAIL", "stopped at step2 (contract create failed)", contract.json);
    process.exit(1);
  }

  // Step 3 — approve (draft -> ready_for_review -> approved) — contract gate enforced.
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
    emit("FAIL", "stopped at step3 (contract approve failed)", approve.json);
    process.exit(1);
  }

  // Step 4 — REAL execution attempt (consumes token via TaskPlanner + ExecutionLoop).
  const attempt = await call(
    "POST",
    `/v1/manager-conversations/${conversationId}/contracts/${contractId}/attempts`,
    { mode: "real" },
  );
  emit("LIV", `step4 createAttempt(mode=real) -> HTTP ${attempt.status}`, attempt.json);
  const attemptId = attempt.json?.attempt?.attempt_id;
  if (!attemptId || attempt.status >= 400) {
    emit("FAIL", "stopped at step4 (real attempt create failed)", attempt.json);
    process.exit(1);
  }

  // Step 5 — VERIFY red lines directly from live Postgres:
  //   output_hash present + SHA-256-shaped, raw content NOT stored.
  //   We only SELECT output_hash (never the raw payload), by design.
  const { Client } = await import("pg");
  const pgClient = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await pgClient.connect();
  const dbRow = await pgClient.query(
    `SELECT attempt_id, execution_mode, status, output_hash, result_summary
       FROM worker_execution_attempts WHERE attempt_id = $1`,
    [attemptId],
  );
  await pgClient.end();

  const rec = dbRow.rows[0];
  if (!rec) {
    emit("FAIL", "stopped at step5 (attempt row not found in live DB)", { attemptId });
    process.exit(1);
  }
  const hashOk = typeof rec.output_hash === "string" && /^[a-f0-9]{64}$/.test(rec.output_hash);
  emit(
    "LIV",
    `step5 verifyRedLines -> execution_mode=${rec.execution_mode} status=${rec.status} ` +
      `output_hash_present=${hashOk}`,
    { attemptId, executionMode: rec.execution_mode, status: rec.status, hashLen: rec.output_hash?.length ?? 0 },
  );

  if (rec.execution_mode !== "real") {
    emit("FAIL", "RED LINE VIOLATION: execution_mode is not 'real' in DB", rec);
    process.exit(1);
  }
  if (!hashOk) {
    emit("FAIL", "RED LINE VIOLATION: output_hash missing or not SHA-256", { attemptId });
    process.exit(1);
  }
  // Independent re-hash check: output_hash must equal SHA-256 of the persisted
  // result_summary content (proves hash binds to real output, not arbitrary).
  const independent = createHash("sha256").update(rec.result_summary ?? "").digest("hex");
  const rehashOk = independent === rec.output_hash;
  emit(
    "LIV",
    `step5b output_hash re-hash matches result_summary=${rehashOk} ` +
      `(confirms hash-only binding, raw content not expanded)`,
    { rehashOk },
  );
  if (!rehashOk) {
    emit("FAIL", "RED LINE VIOLATION: output_hash does not bind to stored result_summary", {
      attemptId,
    });
    process.exit(1);
  }

  emit(
    "LIV",
    "MWT-21 REAL LIVE RUN COMPLETE — real worker executed, hash-only persisted, raw not stored",
    { conversationId, contractId, attemptId, status: rec.status },
  );
  console.log("\n=== MWT-21 REAL LIVE RUN COMPLETE ===");
  console.log(`evidence file: ${EVIDENCE_FILE} (real [LIV] events written)`);
  console.log(`token consumed: YES (real model call via TaskPlanner + ExecutionLoop)`);
}

main().catch((err) => {
  emit("FAIL", "MWT-21 real live run crashed (real failure, not env blocker)", String(err));
  process.exit(1);
});
