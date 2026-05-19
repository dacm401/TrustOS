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
        const doneEvents = lines
          .filter((l) => l.includes("done"))
          .map((l) => {
            try { return JSON.parse(l.slice(6)); } catch { return null; }
          })
          .filter(Boolean);

        // Find the done event with all fields
        let primaryDone = {};
        for (const done of [...doneEvents].reverse()) {
          if (done.ledger || done.verification || done.budget) {
            primaryDone = done;
            break;
          }
        }

        // Also check for CALL_LEDGER event in lines
        const ledgerLine = lines.find(l => l.includes("[CALL_LEDGER]"));
        let ledgerData = null;
        if (ledgerLine) {
          try {
            const ledgerMsg = JSON.parse(ledgerLine);
            ledgerData = ledgerMsg;
          } catch {}
        }

        // Extract artifact meta from done event
        const artifactMeta = primaryDone.artifactMeta || null;
        
        // Extract result content
        const resultLine = lines.find(l => l.includes('"type":"result"'));
        let resultContent = "";
        if (resultLine) {
          try {
            const result = JSON.parse(resultLine.slice(6));
            resultContent = result.stream || "";
          } catch {}
        }

        resolve({
          msg,
          doneCount: doneEvents.length,
          // From done event
          ledger: primaryDone.ledger || {},
          verification: primaryDone.verification,
          budget: primaryDone.budget,
          // From CALL_LEDGER
          ledgerData,
          policyRoute: ledgerData?.policyRoute || primaryDone.ledger?.policyRoute,
          workerCalls: ledgerData?.workerCalls ?? primaryDone.ledger?.slowModelCalls,
          managerCalls: ledgerData?.managerCalls ?? primaryDone.ledger?.managerModelCalls,
          patch: ledgerData?.patch || primaryDone.ledger?.patch,
          artifactMeta,
          resultContent,
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
      taskId: artifactMeta?.taskId || artifactMeta?.task_id || `task_${Date.now()}`,
      artifactId: artifactMeta?.artifactId || artifactMeta?.artifact_id || `artifact_${Date.now()}`,
      summaryForManager: content.substring(0, 200),
      contentType: artifactMeta?.contentType || "code",
    }
  };
}

async function main() {
  console.log("[test] Running S65P Full E2E test...\n");

  // MSG1: Create login page
  const r1 = await testMessage("帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。", []);
  console.log("=== MSG1 ===");
  console.log("policyRoute:", r1.policyRoute);
  console.log("workerCalls:", r1.workerCalls);
  console.log("managerCalls:", r1.managerCalls);
  console.log("verification:", r1.verification?.enabled, r1.verification?.targetType, r1.verification?.passed);
  console.log("patch:", JSON.stringify(r1.patch));
  console.log("artifactMeta:", r1.artifactMeta?.artifactId, r1.artifactMeta?.revisionOfArtifactId ? `(revision of ${r1.artifactMeta.revisionOfArtifactId})` : '(new)');
  console.log("");

  // Build history
  const history = [
    { role: "user", content: "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。" },
  ];
  if (r1.resultContent) {
    history.push(buildWorkerHistoryItem(r1.resultContent, r1.artifactMeta));
  } else {
    history.push(buildWorkerHistoryItem(
      `import React from 'react';
export default function LoginPage() {
  return <div>Login Page</div>;
}`,
      { artifactId: "artifact_msg1", taskId: "task_msg1" }
    ));
  }

  // MSG2: Revision - button blue
  const r2 = await testMessage("把按钮改成蓝色。", history);
  console.log("=== MSG2 ===");
  console.log("policyRoute:", r2.policyRoute);
  console.log("workerCalls:", r2.workerCalls);
  console.log("managerCalls:", r2.managerCalls);
  console.log("verification:", r2.verification?.enabled, r2.verification?.targetType, r2.verification?.passed);
  console.log("patch:", JSON.stringify(r2.patch));
  console.log("artifactMeta:", r2.artifactMeta?.artifactId, r2.artifactMeta?.revisionOfArtifactId ? `(revision of ${r2.artifactMeta.revisionOfArtifactId})` : '(new)');
  console.log("");

  // Continue history
  history.push({ role: "user", content: "把按钮改成蓝色。" });
  if (r2.resultContent) {
    history.push(buildWorkerHistoryItem(r2.resultContent, r2.artifactMeta));
  }

  // MSG3: Revision - title bigger
  const r3 = await testMessage("再把标题改大一点。", history);
  console.log("=== MSG3 ===");
  console.log("policyRoute:", r3.policyRoute);
  console.log("workerCalls:", r3.workerCalls);
  console.log("managerCalls:", r3.managerCalls);
  console.log("verification:", r3.verification?.enabled, r3.verification?.targetType, r3.verification?.passed);
  console.log("patch:", JSON.stringify(r3.patch));
  console.log("artifactMeta:", r3.artifactMeta?.artifactId, r3.artifactMeta?.revisionOfArtifactId ? `(revision of ${r3.artifactMeta.revisionOfArtifactId})` : '(new)');
  console.log("");

  // Continue history
  history.push({ role: "user", content: "再把标题改大一点。" });
  if (r3.resultContent) {
    history.push(buildWorkerHistoryItem(r3.resultContent, r3.artifactMeta));
  }

  // MSG4: New artifact
  const r4 = await testMessage("再帮我写一个注册页。", history);
  console.log("=== MSG4 ===");
  console.log("policyRoute:", r4.policyRoute);
  console.log("workerCalls:", r4.workerCalls);
  console.log("managerCalls:", r4.managerCalls);
  console.log("verification:", r4.verification?.enabled, r4.verification?.targetType, r4.verification?.passed);
  console.log("patch:", JSON.stringify(r4.patch));
  console.log("artifactMeta:", r4.artifactMeta?.artifactId, r4.artifactMeta?.revisionOfArtifactId ? `(revision of ${r4.artifactMeta.revisionOfArtifactId})` : '(new)');
  console.log("");

  // Summary table
  console.log("\n╔══════════════════════════════════════════════════════════════════════════════════════════════════════╗");
  console.log("║                              S65P E2E Runtime Proof Summary                                        ║");
  console.log("╠══════════════════════════════════════════════════════════════════════════════════════════════════════╣");
  console.log("║ Msg │ policyRoute              │ patchAttempted │ patchApplied │ verification │ target │ passed │ mgrs │");
  console.log("╠═════╪═══════════════════════════╪═══════════════╪═════════════╪═════════════╪════════╪═══════╪══════╣");
  console.log(`║ MSG1 │ ${(r1.policyRoute||'').padEnd(23)} │ ${String(r1.patch?.attempted ?? 'N/A').padEnd(14)} │ ${String(r1.patch?.applied ?? 'N/A').padEnd(11)} │ ${String(r1.verification?.enabled ?? 'N/A').padEnd(11)} │ ${String(r1.verification?.targetType||'N/A').padEnd(6)} │ ${String(r1.verification?.passed ?? 'N/A').padEnd(6)} │ ${String(r1.managerCalls ?? 'N/A').padEnd(4)} │`);
  console.log(`║ MSG2 │ ${(r2.policyRoute||'').padEnd(23)} │ ${String(r2.patch?.attempted ?? 'N/A').padEnd(14)} │ ${String(r2.patch?.applied ?? 'N/A').padEnd(11)} │ ${String(r2.verification?.enabled ?? 'N/A').padEnd(11)} │ ${String(r2.verification?.targetType||'N/A').padEnd(6)} │ ${String(r2.verification?.passed ?? 'N/A').padEnd(6)} │ ${String(r2.managerCalls ?? 'N/A').padEnd(4)} │`);
  console.log(`║ MSG3 │ ${(r3.policyRoute||'').padEnd(23)} │ ${String(r3.patch?.attempted ?? 'N/A').padEnd(14)} │ ${String(r3.patch?.applied ?? 'N/A').padEnd(11)} │ ${String(r3.verification?.enabled ?? 'N/A').padEnd(11)} │ ${String(r3.verification?.targetType||'N/A').padEnd(6)} │ ${String(r3.verification?.passed ?? 'N/A').padEnd(6)} │ ${String(r3.managerCalls ?? 'N/A').padEnd(4)} │`);
  console.log(`║ MSG4 │ ${(r4.policyRoute||'').padEnd(23)} │ ${String(r4.patch?.attempted ?? 'N/A').padEnd(14)} │ ${String(r4.patch?.applied ?? 'N/A').padEnd(11)} │ ${String(r4.verification?.enabled ?? 'N/A').padEnd(11)} │ ${String(r4.verification?.targetType||'N/A').padEnd(6)} │ ${String(r4.verification?.passed ?? 'N/A').padEnd(6)} │ ${String(r4.managerCalls ?? 'N/A').padEnd(4)} │`);
  console.log("╚═════╧═══════════════════════════╧═══════════════╧═════════════╧═════════════╧════════╧═══════╧══════╝");

  // Validation
  console.log("\n=== PM Validation ===");
  let passed = true;

  const checks = [
    [r2.policyRoute === 'direct_artifact_revision', `MSG2 policyRoute=${r2.policyRoute}, expected direct_artifact_revision`],
    [r3.policyRoute === 'direct_artifact_revision', `MSG3 policyRoute=${r3.policyRoute}, expected direct_artifact_revision`],
    [r4.policyRoute === 'direct_create_artifact', `MSG4 policyRoute=${r4.policyRoute}, expected direct_create_artifact`],
    [r1.verification?.enabled === true, `MSG1 verification.enabled=${r1.verification?.enabled}`],
    [r2.verification?.enabled === true, `MSG2 verification.enabled=${r2.verification?.enabled}`],
    [r3.verification?.enabled === true, `MSG3 verification.enabled=${r3.verification?.enabled}`],
    [r4.verification?.enabled === true, `MSG4 verification.enabled=${r4.verification?.enabled}`],
    [r1.verification?.passed === true, `MSG1 verification.passed=${r1.verification?.passed}`],
    [r2.verification?.passed === true, `MSG2 verification.passed=${r2.verification?.passed}`],
    [r3.verification?.passed === true, `MSG3 verification.passed=${r3.verification?.passed}`],
    [r4.verification?.passed === true, `MSG4 verification.passed=${r4.verification?.passed}`],
    [r1.managerCalls === 0 || r1.managerCalls == null, `MSG1 managerCalls=${r1.managerCalls}`],
    [r2.managerCalls === 0, `MSG2 managerCalls=${r2.managerCalls}`],
    [r3.managerCalls === 0, `MSG3 managerCalls=${r3.managerCalls}`],
  ];

  for (const [ok, desc] of checks) {
    console.log(`${ok ? '✓' : '✗'} ${desc}`);
    if (!ok) passed = false;
  }

  console.log(`\n=== Result: ${passed ? 'PASS ✅' : 'PARTIAL ⚠️'} ===`);
}

main().catch(console.error);
