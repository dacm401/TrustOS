#!/usr/bin/env node
/**
 * Debug: capture ALL SSE events from a single MSG2 request
 */
import http from "http";

function sseRequestDebug(msg, history) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ message: msg, history, stream: true, execute: true });
    const options = {
      hostname: "localhost", port: 3001, path: "/api/chat", method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-token-s66p", "Content-Length": Buffer.byteLength(body) },
    };
    const allEvents = [];
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
            allEvents.push(ev);
          } catch {}
        }
      });
      res.on("end", () => resolve(allEvents));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
    // 60s timeout
    setTimeout(() => { req.destroy(); resolve(allEvents); }, 60000);
  });
}

async function main() {
  // Pre-built history with verification
  const history = [
    { role: "user", content: "创建一个HTML登录页。" },
    {
      role: "assistant",
      content: "<html><body>Login</body></html>",
      meta: {
        origin: "worker",
        contentKind: "artifact",
        taskId: "art-task-1",
        artifactId: "art-001",
        summaryForManager: "Login page",
        verification: { enabled: true, passed: true, score: 0.9, issues: [] },
      }
    }
  ];

  console.log("[debug] Sending MSG2 with history containing verification...");
  const events = await sseRequestDebug("把按钮颜色改成蓝色。", history);
  console.log(`[debug] Total events: ${events.length}`);
  
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const keys = Object.keys(ev);
    console.log(`\n=== Event ${i} (type=${ev.type}) keys: ${keys.join(", ")} ===`);
    if (ev.type === "done") {
      console.log("  ledger:", JSON.stringify(ev.ledger, null, 2));
      console.log("  qualityRouting (top-level):", JSON.stringify(ev.qualityRouting, null, 2));
      console.log("  verification (top-level):", JSON.stringify(ev.verification, null, 2));
    }
  }
}

main().catch(e => console.error("Fatal:", e.message));
