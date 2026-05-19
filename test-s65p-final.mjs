#!/usr/bin/env node
import http from "http";

async function testMessage(msg, history = []) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ message: msg, history, stream: true, execute: true });
    const options = {
      hostname: "localhost",
      port: 3001,
      path: "/api/chat",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        Authorization: "Bearer test-token-s65p",
      },
    };

    const req = http.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk.toString()));
      res.on("end", () => {
        const lines = data.split("\n").filter((l) => l.startsWith("data: "));
        
        // Extract from SSE done events
        const doneEvents = lines
          .filter((l) => l.includes("done"))
          .map((l) => {
            try { return JSON.parse(l.slice(6)); } catch { return null; }
          })
          .filter(Boolean);
        
        const primaryDone = [...doneEvents].reverse().find(e => e.budget || e.verification) || {};
        const artifactMeta = primaryDone.artifactMeta || null;
        
        // Extract from CALL_LEDGER lines
        let ledgerData = null;
        for (const line of lines) {
          if (line.includes("[CALL_LEDGER]")) {
            try {
              ledgerData = JSON.parse(line);
              break;
            } catch {}
          }
        }
        
        resolve({
          msg,
          doneCount: doneEvents.length,
          policyRoute: ledgerData?.policyRoute || primaryDone.ledger?.policyRoute,
          managerCalls: ledgerData?.managerCalls,
          workerCalls: ledgerData?.workerCalls,
          patch: ledgerData?.patch || primaryDone.ledger?.patch,
          patchFirstEligible: ledgerData?.localManager?.patchFirstEligible,
          verification: primaryDone.verification,
          budget: primaryDone.budget,
          artifactMeta,
          resultContent: data.includes('"type":"result"') ? 
            (() => { const r = lines.find(l => l.includes('"type":"result"')); return r ? JSON.parse(r.slice(6))?.stream || "" : ""; })() : "",
        });
      });
    });

    req.write(body);
    req.end();
  });
}

function buildWorkerHistoryItem(content, artifactMeta) {
  return {
    role: "assistant",
    content: content,
    meta: {
      origin: "worker",
      contentKind: "artifact",
      taskId: artifactMeta?.taskId || `task_${Date.now()}`,
      artifactId: artifactMeta?.artifactId || `artifact_${Date.now()}`,
      summaryForManager: content.substring(0, 200),
      contentType: "code",
    }
  };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("          Sprint 65P E2E Runtime Proof - Final Report");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const results = [];
  const history = [];

  // MSG1: Create login page
  console.log("[1/4] MSG1: 创建登录页...");
  const r1 = await testMessage("帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。", []);
  history.push({ role: "user", content: r1.msg });
  if (r1.resultContent) {
    history.push(buildWorkerHistoryItem(r1.resultContent, r1.artifactMeta));
  } else {
    history.push(buildWorkerHistoryItem("export default function LoginPage(){return <div>Login</div>}", { artifactId: "art_msg1" }));
  }
  results.push({ label: "MSG1", ...r1 });
  console.log(`   policyRoute: ${r1.policyRoute || 'N/A (first msg)'}`);
  console.log(`   verification: ${r1.verification?.enabled ? 'enabled='+r1.verification.enabled+', targetType='+r1.verification.targetType+', passed='+r1.verification.passed : 'N/A (no history)'}`);
  console.log("");

  // MSG2: Revision - button blue
  console.log("[2/4] MSG2: 按钮改蓝色 (revision path)...");
  const r2 = await testMessage("把按钮改成蓝色。", history);
  history.push({ role: "user", content: r2.msg });
  if (r2.resultContent) {
    history.push(buildWorkerHistoryItem(r2.resultContent, r2.artifactMeta));
  }
  results.push({ label: "MSG2", ...r2 });
  console.log(`   policyRoute: ${r2.policyRoute}`);
  console.log(`   verification: enabled=${r2.verification?.enabled}, targetType=${r2.verification?.targetType}, passed=${r2.verification?.passed}`);
  console.log(`   patchFirstEligible: ${r2.patchFirstEligible}`);
  console.log(`   managerCalls: ${r2.managerCalls}, workerCalls: ${r2.workerCalls}`);
  console.log("");

  // MSG3: Revision - title bigger
  console.log("[3/4] MSG3: 标题改大 (continuous revision)...");
  const r3 = await testMessage("再把标题改大一点。", history);
  history.push({ role: "user", content: r3.msg });
  if (r3.resultContent) {
    history.push(buildWorkerHistoryItem(r3.resultContent, r3.artifactMeta));
  }
  results.push({ label: "MSG3", ...r3 });
  console.log(`   policyRoute: ${r3.policyRoute}`);
  console.log(`   verification: enabled=${r3.verification?.enabled}, targetType=${r3.verification?.targetType}, passed=${r3.verification?.passed}`);
  console.log(`   patchFirstEligible: ${r3.patchFirstEligible}`);
  console.log(`   managerCalls: ${r3.managerCalls}, workerCalls: ${r3.workerCalls}`);
  console.log("");

  // MSG4: New artifact
  console.log("[4/4] MSG4: 创建注册页 (new artifact)...");
  const r4 = await testMessage("再帮我写一个注册页。", history);
  results.push({ label: "MSG4", ...r4 });
  console.log(`   policyRoute: ${r4.policyRoute}`);
  console.log(`   verification: enabled=${r4.verification?.enabled}, targetType=${r4.verification?.targetType}, passed=${r4.verification?.passed}`);
  console.log(`   managerCalls: ${r4.managerCalls}, workerCalls: ${r4.workerCalls}`);
  console.log("");

  // Summary Table
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    E2E Runtime Proof Table");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("| Msg | policyRoute                | patchEligible | verification | targetType | passed | mgrs | wrks |");
  console.log("|-----|---------------------------|:-------------:|:------------:|:----------:|:------:|:----:|:----:|");
  for (const r of results) {
    const route = (r.policyRoute || 'N/A').padEnd(23);
    const patchElig = String(r.patchFirstEligible ?? 'N/A').padEnd(12);
    const verif = r.verification?.enabled ?? 'N/A';
    const target = r.verification?.targetType ?? 'N/A';
    const passed = r.verification?.passed ?? 'N/A';
    const mgrs = r.managerCalls ?? 'N/A';
    const wrks = r.workerCalls ?? 'N/A';
    console.log(`| ${r.label.padEnd(4)} | ${route} | ${patchElig} | ${String(verif).padEnd(12)} | ${String(target).padEnd(10)} | ${String(passed).padEnd(6)} | ${String(mgrs).padEnd(3)} | ${String(wrks).padEnd(3)} |`);
  }
  console.log("═══════════════════════════════════════════════════════════════");

  // PM Validation
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("                    PM Validation");
  console.log("═══════════════════════════════════════════════════════════════");
  let allPassed = true;

  const checks = [
    // Core routing
    ["MSG2", r2.policyRoute === 'direct_artifact_revision', `policyRoute=${r2.policyRoute}, expected direct_artifact_revision`],
    ["MSG3", r3.policyRoute === 'direct_artifact_revision', `policyRoute=${r3.policyRoute}, expected direct_artifact_revision`],
    ["MSG4", r4.policyRoute === 'direct_create_artifact', `policyRoute=${r4.policyRoute}, expected direct_create_artifact`],
    // Verification enabled
    ["MSG2", r2.verification?.enabled === true, `verification.enabled=${r2.verification?.enabled}`],
    ["MSG3", r3.verification?.enabled === true, `verification.enabled=${r3.verification?.enabled}`],
    ["MSG4", r4.verification?.enabled === true, `verification.enabled=${r4.verification?.enabled}`],
    // Verification passed
    ["MSG2", r2.verification?.passed === true, `verification.passed=${r2.verification?.passed}`],
    ["MSG3", r3.verification?.passed === true, `verification.passed=${r3.verification?.passed}`],
    ["MSG4", r4.verification?.passed === true, `verification.passed=${r4.verification?.passed}`],
    // Manager bypassed
    ["MSG2", r2.managerCalls === 0, `managerCalls=${r2.managerCalls}`],
    ["MSG3", r3.managerCalls === 0, `managerCalls=${r3.managerCalls}`],
    ["MSG4", r4.managerCalls === 0, `managerCalls=${r4.managerCalls}`],
    // Worker called
    ["MSG2", r2.workerCalls === 1, `workerCalls=${r2.workerCalls}`],
    ["MSG3", r3.workerCalls === 1, `workerCalls=${r3.workerCalls}`],
    ["MSG4", r4.workerCalls === 1, `workerCalls=${r4.workerCalls}`],
  ];

  for (const [msg, ok, desc] of checks) {
    console.log(`${ok ? '✓' : '✗'} [${msg}] ${desc}`);
    if (!ok) allPassed = false;
  }

  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`                    RESULT: ${allPassed ? 'ALL PASS ✅' : 'PARTIAL ⚠️'}`);
  console.log("═══════════════════════════════════════════════════════════════");
  
  // PM Conclusion
  console.log("\n【PM 验收结论】");
  if (allPassed) {
    console.log("S65P E2E 验收：通过 ✅");
    console.log("- MSG2/MSG3 正确走 direct_artifact_revision 路径");
    console.log("- MSG4 正确走 direct_create_artifact 路径");
    console.log("- 所有 artifact 消息都启用了 verification");
    console.log("- 所有 verification 都 passed=true");
    console.log("- Manager LLM 全部 bypassed（managerCalls=0）");
    console.log("- Worker 全部正常调用（workerCalls=1）");
  } else {
    console.log("S65P E2E 验收：部分通过 ⚠️");
    console.log("请检查上述失败的检查项。");
  }
}

main().catch(console.error);
