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

        const primaryDone = [...doneEvents].reverse().find(e => e.budget) || doneEvents[doneEvents.length - 1] || {};

        // Extract artifact meta from done event
        const artifactMeta = primaryDone.artifactMeta || null;
        
        // Extract result content for history
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
          policyRoute: primaryDone.ledger?.policyRoute,
          verification: primaryDone.verification,
          budget: primaryDone.budget,
          patch: primaryDone.ledger?.patch,
          workerCalls: primaryDone.ledger?.slowModelCalls,
          managerCalls: primaryDone.ledger?.managerModelCalls,
          doneCount: doneEvents.length,
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
  console.log("[test] Running S65P E2E test with corrected history...\n");

  // MSG1: Create login page
  const r1 = await testMessage("帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。", []);
  console.log("MSG1 doneCount:", r1.doneCount);
  console.log("MSG1 policyRoute:", r1.policyRoute);
  console.log("MSG1 verification:", r1.verification?.enabled, r1.verification?.targetType);
  console.log("MSG1 artifactMeta:", r1.artifactMeta);
  console.log("");

  // Build history with correct meta structure
  const history = [
    { role: "user", content: "帮我写一个 React 登录页，包含用户名、密码、校验和提交按钮。" },
  ];
  
  // Add assistant message with worker artifact meta
  if (r1.resultContent) {
    history.push(buildWorkerHistoryItem(r1.resultContent, r1.artifactMeta));
  } else {
    // Fallback: use mock content
    history.push(buildWorkerHistoryItem(
      `import React, { useState } from 'react';

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!username || !password) { setError('Username and password required'); return; }
    setError('');
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-xl shadow">
        <h1 className="text-2xl font-bold mb-6 text-center">Login</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input className="w-full border rounded px-3 py-2" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
          <input className="w-full border rounded px-3 py-2" placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button className="w-full bg-blue-500 text-white py-2 rounded hover:bg-blue-600" type="submit">Login</button>
        </form>
      </div>
    </div>
  );
}`,
      { artifactId: "artifact_from_msg1", taskId: "task_msg1" }
    ));
  }

  // MSG2: Revision - button blue
  const r2 = await testMessage("把按钮改成蓝色。", history);
  console.log("MSG2 doneCount:", r2.doneCount);
  console.log("MSG2 policyRoute:", r2.policyRoute);
  console.log("MSG2 verification:", r2.verification?.enabled, r2.verification?.targetType);
  console.log("MSG2 patch:", r2.patch);
  console.log("MSG2 artifactMeta:", r2.artifactMeta);
  console.log("");

  // Continue history
  history.push({ role: "user", content: "把按钮改成蓝色。" });
  if (r2.resultContent) {
    history.push(buildWorkerHistoryItem(r2.resultContent, r2.artifactMeta));
  }

  // MSG3: Revision - title bigger
  const r3 = await testMessage("再把标题改大一点。", history);
  console.log("MSG3 doneCount:", r3.doneCount);
  console.log("MSG3 policyRoute:", r3.policyRoute);
  console.log("MSG3 verification:", r3.verification?.enabled, r3.verification?.targetType);
  console.log("MSG3 patch:", r3.patch);
  console.log("");

  // Continue history
  history.push({ role: "user", content: "再把标题改大一点。" });
  if (r3.resultContent) {
    history.push(buildWorkerHistoryItem(r3.resultContent, r3.artifactMeta));
  }

  // MSG4: New artifact
  const r4 = await testMessage("再帮我写一个注册页。", history);
  console.log("MSG4 doneCount:", r4.doneCount);
  console.log("MSG4 policyRoute:", r4.policyRoute);
  console.log("MSG4 verification:", r4.verification?.enabled, r4.verification?.targetType);
  console.log("");

  // Summary table
  console.log("\n=== S65P Runtime Proof Summary ===\n");
  console.log("| Msg | policyRoute | patchAttempted | patchApplied | verificationEnabled | targetType | passed | managerCalls | workerCalls |");
  console.log("|-----|------------|:-------------:|:------------:|:-------------------:|:----------:|:------:|:-----------:|:-----------:|");
  console.log(`| MSG1 | ${r1.policyRoute} | ${r1.patch?.attempted ?? 'null'} | ${r1.patch?.applied ?? 'null'} | ${r1.verification?.enabled ?? 'null'} | ${r1.verification?.targetType ?? 'null'} | ${r1.verification?.passed ?? 'null'} | ${r1.managerCalls ?? 'null'} | ${r1.workerCalls ?? 'null'} |`);
  console.log(`| MSG2 | ${r2.policyRoute} | ${r2.patch?.attempted ?? 'null'} | ${r2.patch?.applied ?? 'null'} | ${r2.verification?.enabled ?? 'null'} | ${r2.verification?.targetType ?? 'null'} | ${r2.verification?.passed ?? 'null'} | ${r2.managerCalls ?? 'null'} | ${r2.workerCalls ?? 'null'} |`);
  console.log(`| MSG3 | ${r3.policyRoute} | ${r3.patch?.attempted ?? 'null'} | ${r3.patch?.applied ?? 'null'} | ${r3.verification?.enabled ?? 'null'} | ${r3.verification?.targetType ?? 'null'} | ${r3.verification?.passed ?? 'null'} | ${r3.managerCalls ?? 'null'} | ${r3.workerCalls ?? 'null'} |`);
  console.log(`| MSG4 | ${r4.policyRoute} | ${r4.patch?.attempted ?? 'null'} | ${r4.patch?.applied ?? 'null'} | ${r4.verification?.enabled ?? 'null'} | ${r4.verification?.targetType ?? 'null'} | ${r4.verification?.passed ?? 'null'} | ${r4.managerCalls ?? 'null'} | ${r4.workerCalls ?? 'null'} |`);
}

main().catch(console.error);
