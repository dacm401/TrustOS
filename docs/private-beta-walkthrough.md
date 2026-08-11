# TrustOS — Private Beta Walkthrough

```text
Version: v0.1
Date: 2026-08-03
Baseline: TRST-2C CLOSED, Product Loop VALIDATED
Maturity: Private Beta Candidate — Product Loop Validated
```

---

## 1. Prerequisites

- **Node.js** 18+ installed
- **API Key** for an OpenAI-compatible LLM provider (e.g., OpenAI, SiliconFlow)
- **Git** to clone the repository

---

## 2. Setup

```bash
git clone <repo-url>
cd trustos
npm install
```

---

## 3. Configure Environment

Create or edit `.env` in the project root:

```env
# Required — LLM upstream provider
TRUSTOS_UPSTREAM_BASE_URL=https://api.siliconflow.cn
TRUSTOS_UPSTREAM_API_KEY=sk-your-key-here

# Optional — defaults shown
TRUSTOS_GATEWAY_PORT=8787
TRUSTOS_PROJECT_ID=local-dev
TRUSTOS_EVENT_LOG_PATH=.trustos/events.jsonl
```

---

## 4. Start the Gateway (Canonical Path)

This is the **single blessed startup path** for Private Beta.

```bash
npm run trst1:gateway
```

Or equivalently:

```bash
npx tsx scripts/trst1/start-gateway.ts
```

Expected output:

```
TrustOS Gateway — Private Beta
  Listening:    http://localhost:8787
  Mode:         Shadow (dry-run control only)
  Streaming:    unsupported (stream=false only)
  LLM Upstream: https://api.siliconflow.cn
  MCP Upstream: (not configured)
  Event log:    .trustos/events.jsonl
  Project:      local-dev
  Evidence:     Privacy-safe, hash-based verification only

Ready. Press Ctrl+C to stop.
```

---

## 5. Verify Gateway Health

```bash
curl http://localhost:8787/health
```

Expected: `{"status":"ok"}`

---

## 6. Send a Test Model Call

```bash
curl -s -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-V3",
    "messages": [{"role": "user", "content": "Hello, TrustOS."}],
    "temperature": 0,
    "max_tokens": 50
  }'
```

Expected: A valid OpenAI-compatible chat completion response with `X-TrustOS-Trace-Id` header.

---

## 7. Inspect Events

Events are written to `.trustos/events.jsonl`. Each event contains:

- `event_id` — unique event identifier
- `trace_id` — groups related events in the same trace
- `event_type` — e.g., `model_call`
- `event_hash` — SHA256 hash of the event (excluding hash field itself)
- `input_hash` — SHA256 hash of the input/messages
- `output_hash` — SHA256 hash of the model response (non-streaming success only)
- `agent_id` — request source label
- `status` — `success` or `error`
- `timestamp` — ISO 8601

---

## 8. Run Assessment

To assess governance signals on recorded events:

```bash
npx tsx scripts/trst2/run-assess-signal-smoke.mjs
```

This produces risk ratings:
- **Low risk** — no suspicious signals detected
- **Review** — governance signals require reviewer attention
- **High risk** — privacy/security-sensitive signals detected

---

## 9. Generate Evidence Bundle

To produce a privacy-safe evidence bundle:

```bash
node scripts/trst2/run-prove-evidence-smoke.mjs
```

The evidence bundle contains:
- Event hashes and metadata
- Risk assessment result
- Dry-run control recommendation
- **No raw prompts, raw outputs, or raw model content**

---

## 10. Verify Output Hash (Reviewer-Side)

If you have independent access to the original model output, you can verify the `output_hash`:

```bash
# In Node.js:
const crypto = require("crypto");
const actualOutput = "{... model response text ...}";
const computedHash = crypto.createHash("sha256").update(actualOutput, "utf8").digest("hex");
// Compare computedHash with the output_hash in the evidence bundle
```

---

## 11. Run Full Private Beta Smoke

```bash
node scripts/trst3/run-private-beta-smoke.mjs
```

This validates:
1. Gateway health
2. Fresh non-streaming model call
3. Event readback and hash presence
4. Assessment correctness
5. Dry-run control mode
6. Evidence bundle generation
7. Privacy safety (no raw content)

---

## 12. Run Multi-Event Trace Demo

```bash
node scripts/trst3/run-multi-event-trace-demo.mjs
```

Demonstrates multiple events sharing a single `trace_id` and how correlation helps governance review.

---

## Next Steps After Walkthrough

- Review `docs/private-beta-limitations.md` for what TrustOS does and does not provide
- Open `.trustos/events.jsonl` to inspect raw event data
- Explore the TrustOS Dashboard (if frontend is available)
