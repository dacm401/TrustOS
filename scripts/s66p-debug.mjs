#!/usr/bin/env node
/**
 * Minimal debug: single MSG2 with known verification in history
 * Just logs the raw qualityRouting from the done event.
 */
import http from "http";

const BASE_URL = "http://localhost:3001";

function sseRequest(msg, history) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message: msg, history, stream: true, execute: true });
    const options = {
      hostname: "localhost", port: 3001, path: "/api/chat", method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-s66p", "Content-Length": Buffer.byteLength(body) },
    };
    const req = http.request(options, (res) => {
      let buf = "";
      res.on("data", (chunk) => {
        buf += chunk.toString();
        const lines = buf.split("\n");
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "done") {
              resolve(ev); // Return first done event immediately
            }
          } catch {}
        }
      });
      res.on("end", () => resolve(null));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  // Step 1: Create an artifact (MSG1 equivalent)
  console.log("[debug] Step 1: Creating artifact...");
  const r1 = await sseRequest("创建一个简单的HTML登录页面。", []);
  console.log("[debug] Step 1 done event keys:", Object.keys(r1 || {}));
  if (r1) {
    console.log("[debug] Step 1 ledger:", JSON.stringify(r1.ledger, null, 2));
    console.log("[debug] Step 1 verification:", JSON.stringify(r1.verification, null, 2));
    console.log("[debug] Step 1 qualityRouting:", JSON.stringify(r1.qualityRouting, null, 2));
  }

  // Step 2: Build history with verification embedded
  const history = [
    { role: "user", content: "创建一个简单的HTML登录页面。" },
    {
      role: "assistant",
      content: "<html><body>Login</body></html>",
      meta: {
        origin: "worker",
        contentKind: "artifact",
        taskId: "art-task-1",
        artifactId: "art-001",
        verification: { enabled: true, passed: true, score: 0.9, issues: [] },
      }
    }
  ];

  // Step 3: Revision with quality history
  console.log("\n[debug] Step 2: Revision with quality history...");
  const r2 = await sseRequest("把按钮改成蓝色。", history);
  console.log("[debug] Step 2 done event keys:", Object.keys(r2 || {}));
  if (r2) {
    console.log("[debug] Step 2 ledger:", JSON.stringify(r2.ledger, null, 2));
    console.log("[debug] Step 2 qualityRouting:", JSON.stringify(r2.qualityRouting, null, 2));
    console.log("[debug] Step 2 verification:", JSON.stringify(r2.verification, null, 2));
  }
}

main().catch(e => console.error("Fatal:", e.message));
