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
        // Find the last done event with budget
        const doneEvents = lines
          .filter((l) => l.includes("done"))
          .map((l) => {
            try { return JSON.parse(l.slice(6)); } catch { return null; }
          })
          .filter(Boolean);

        const primaryDone = [...doneEvents].reverse().find(e => e.budget) || doneEvents[doneEvents.length - 1] || {};

        resolve({
          msg,
          policyRoute: primaryDone.ledger?.policyRoute,
          verification: primaryDone.verification,
          budget: primaryDone.budget,
          patch: primaryDone.ledger?.patch,
          workerCalls: primaryDone.ledger?.slowModelCalls,
          managerCalls: primaryDone.ledger?.managerModelCalls,
          doneCount: doneEvents.length,
        });
      });
    });

    req.write(body);
    req.end();
  });
}

async function main() {
  console.log("[test] Running S65P E2E test...\n");

  // MSG1: Create login page
  const r1 = await testMessage("帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。", []);
  console.log("MSG1:", JSON.stringify(r1, null, 2));

  // Build history with artifact meta
  const history = [
    { role: "user", content: "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。" },
    {
      role: "assistant",
      content: r1.resultContent || "// mock React component",
      meta: {
        origin: "worker",
        contentKind: "artifact",
        taskId: "task_1",
        artifactId: "artifact_1",
      },
    },
  ];

  // MSG2: Revision - button blue
  const r2 = await testMessage("把按钮改成蓝色。", history);
  console.log("\nMSG2:", JSON.stringify(r2, null, 2));

  // Continue history
  history.push({ role: "user", content: "把按钮改成蓝色。" });
  history.push({
    role: "assistant",
    content: r2.resultContent || "// mock React component",
    meta: {
      origin: "worker",
      contentKind: "artifact",
      taskId: "task_2",
      artifactId: "artifact_2",
    },
  });

  // MSG3: Revision - title bigger
  const r3 = await testMessage("再把标题改大一点。", history);
  console.log("\nMSG3:", JSON.stringify(r3, null, 2));

  // Continue history
  history.push({ role: "user", content: "再把标题改大一点。" });
  history.push({
    role: "assistant",
    content: r3.resultContent || "// mock React component",
    meta: {
      origin: "worker",
      contentKind: "artifact",
      taskId: "task_3",
      artifactId: "artifact_3",
    },
  });

  // MSG4: New artifact
  const r4 = await testMessage("再帮我写一个注册页。", history);
  console.log("\nMSG4:", JSON.stringify(r4, null, 2));

  // Summary table
  console.log("\n\n=== S65P Runtime Proof Summary ===\n");
  console.log("| Msg | policyRoute | patchAttempted | patchApplied | verificationEnabled | targetType | passed | managerCalls | workerCalls |");
  console.log("|-----|------------|:-------------:|:------------:|:-------------------:|:----------:|:------:|:-----------:|:-----------:|");
  console.log(`| MSG1 | ${r1.policyRoute} | ${r1.patch?.attempted ?? 'null'} | ${r1.patch?.applied ?? 'null'} | ${r1.verification?.enabled ?? 'null'} | ${r1.verification?.targetType ?? 'null'} | ${r1.verification?.passed ?? 'null'} | ${r1.managerCalls ?? 'null'} | ${r1.workerCalls ?? 'null'} |`);
  console.log(`| MSG2 | ${r2.policyRoute} | ${r2.patch?.attempted ?? 'null'} | ${r2.patch?.applied ?? 'null'} | ${r2.verification?.enabled ?? 'null'} | ${r2.verification?.targetType ?? 'null'} | ${r2.verification?.passed ?? 'null'} | ${r2.managerCalls ?? 'null'} | ${r2.workerCalls ?? 'null'} |`);
  console.log(`| MSG3 | ${r3.policyRoute} | ${r3.patch?.attempted ?? 'null'} | ${r3.patch?.applied ?? 'null'} | ${r3.verification?.enabled ?? 'null'} | ${r3.verification?.targetType ?? 'null'} | ${r3.verification?.passed ?? 'null'} | ${r3.managerCalls ?? 'null'} | ${r3.workerCalls ?? 'null'} |`);
  console.log(`| MSG4 | ${r4.policyRoute} | ${r4.patch?.attempted ?? 'null'} | ${r4.patch?.applied ?? 'null'} | ${r4.verification?.enabled ?? 'null'} | ${r4.verification?.targetType ?? 'null'} | ${r4.verification?.passed ?? 'null'} | ${r4.managerCalls ?? 'null'} | ${r4.workerCalls ?? 'null'} |`);
}

main().catch(console.error);
