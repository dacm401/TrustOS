/**
 * Check the egress processor for FALSE POSITIVES on legitimate content.
 * A redaction that mangles a JSON schema or code sample is worse than
 * no redaction at all: it silently breaks the outbound prompt.
 */

import { processEgress, type EgressPolicy } from "../src/services/egress/egress-processor.js";
import type { ChatMessage } from "../src/types/index.js";

const STANDARD: EgressPolicy = {
  level: "standard", redactSecrets: true, redactPII: true,
  maxHistoryTurns: 6, maxMessageChars: 12000,
};

const cases: Array<{ label: string; text: string; mustKeep: string[] }> = [
  {
    label: "JSON schema field names",
    text: 'Respond with JSON: {"api_key": "PLACEHOLDER", "secret": "PLACEHOLDER", "model": "gpt-4"}',
    mustKeep: ["api_key", "secret", "model"],
  },
  {
    label: "TS interface",
    text: "interface Config { apiKey: string; accessToken: string; }",
    mustKeep: ["apiKey", "accessToken"],
  },
  {
    label: "Python code sample",
    text: "def connect(api_key, password):\n    return client.login(api_key, password)",
    mustKeep: ["api_key", "password"],
  },
  {
    label: "env var reference",
    text: "load api_key from process.env.OPENAI_API_KEY",
    mustKeep: ["api_key", "OPENAI_API_KEY"],
  },
  {
    label: "ordinary sentence with colon",
    text: "Note: the following steps are required",
    mustKeep: ["the following steps are required"],
  },
  {
    label: "markdown table",
    text: "| field | type |\n|---|---|\n| api_key | string |",
    mustKeep: ["api_key"],
  },
];

let bad = 0;
console.log("\n── False-positive scan ──────────────────────────────────");
for (const c of cases) {
  const r = processEgress([{ role: "system", content: c.text } as ChatMessage], STANDARD);
  const out = r.messages[0].content;
  const missing = c.mustKeep.filter((k) => !out.includes(k));
  const hits = Object.keys(r.stats.redactions);
  if (missing.length > 0) {
    bad++;
    console.log(`  ❌ ${c.label}`);
    console.log(`     lost: ${missing.join(", ")}`);
    console.log(`     hits: ${hits.join(",") || "none"}`);
    console.log(`     out : ${out.slice(0, 140)}`);
  } else {
    console.log(`  ✅ ${c.label}${hits.length ? ` (hits: ${hits.join(",")})` : ""}`);
  }
}

console.log(`\n${bad === 0 ? "✅ NO FALSE POSITIVES" : `❌ ${bad} case(s) mangled by over-aggressive redaction`}\n`);
process.exit(bad === 0 ? 0 : 1);
