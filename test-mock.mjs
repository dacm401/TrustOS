#!/usr/bin/env node
import http from "http";

const body = JSON.stringify({
  message: "写一个简单登录页",
  history: [],
  stream: true,
  execute: true,
});

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
    console.log("Done events:", lines.filter((l) => l.includes("done")).length);
    const doneLine = lines.find((l) => l.includes("done"));
    if (doneLine) {
      const done = JSON.parse(doneLine.slice(6));
      console.log("Policy route:", done.ledger?.policyRoute);
      console.log("Verification:", done.verification);
    }
  });
});

req.write(body);
req.end();
