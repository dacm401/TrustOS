# TRST-1 Execution Trace MVP — Test Plan

Version: v0.1
Date: 2026-07-14
Status: Draft for TRST-1A/1B MVP Implementation

---

## 1. MVP Goal

TRST-1A/1B validates the core hypothesis:

```text
Can TrustOS reliably sit in the execution path of real agents,
capture model/tool calls with acceptable overhead,
and generate a unified shadow evidence report?
```

Specifically, TRST-1A/1B will:

1. Provide a local HTTP Gateway that proxies real OpenAI-compatible `/v1/chat/completions` calls
2. Capture `model_call` events into an append-only JSONL event store
3. Provide a minimal Tool Trace CLI to record `tool_call` events
4. Generate a Shadow Report from real execution data

---

## 2. Charter Deviation

```text
TRST-1A/1B deliberately defers real MCP passthrough to TRST-1C.
This does not waive the Charter's MCP validation criterion.
It sequences MCP validation after the real LLM Gateway MVP is stable.

The TRST-1 Charter v0.1 §2.1 requires:
  "An OpenAI-compatible client and an MCP client successfully route
   through the Gateway"

TRST-1A validates the OpenAI-compatible client path.  
TRST-1B validates the tool_call event envelope via CLI (not MCP).  
TRST-1C will validate the real MCP Broker passthrough path.

Full Charter validation is pending TRST-1C completion.
```

---

## 3. Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `TRUSTOS_GATEWAY_PORT` | No | `8787` | Gateway HTTP port |
| `TRUSTOS_UPSTREAM_BASE_URL` | **Yes** | — | Upstream API base URL |
| `TRUSTOS_UPSTREAM_API_KEY` | **Yes** | — | Upstream API key |
| `TRUSTOS_EVENT_LOG_PATH` | No | `.trustos/events.jsonl` | Event log file path |
| `TRUSTOS_PROJECT_ID` | No | `local-dev` | Project identifier |

### Optional Identity Headers

| Header | Default |
|---|---|
| `X-TrustOS-Session-Id` | Auto-generated UUID |
| `X-TrustOS-Trace-Id` | Auto-generated UUID |
| `X-TrustOS-Agent-Id` | `unknown-agent` |
| `X-TrustOS-Actor-Id` | `local-user` |

---

## 4. Starting the Gateway

```bash
# Using real provider (e.g. SiliconFlow)
TRUSTOS_UPSTREAM_BASE_URL=https://api.siliconflow.cn \
TRUSTOS_UPSTREAM_API_KEY=$SILICONFLOW_API_KEY \
npm run trst1:gateway

# Expected output:
# TrustOS TRST-1 Gateway
#   Listening:  http://localhost:8787
#   Mode:       Shadow
#   Streaming:  unsupported (stream=false only)
#   Upstream:   https://api.siliconflow.cn
#   Event log:  .trustos/events.jsonl
#   Project:    local-dev
#   Ready. Press Ctrl+C to stop.
```

---

## 5. Real Model Call (curl)

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek-ai/DeepSeek-V3",
    "stream": false,
    "messages": [
      {"role": "system", "content": "You are a concise assistant."},
      {"role": "user", "content": "Say hello in one sentence."}
    ]
  }'
```

**Expected**: Real model response returned. Event written to `.trustos/events.jsonl`.

### With Identity Headers

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "X-TrustOS-Session-Id: my-test-session" \
  -H "X-TrustOS-Agent-Id: test-agent" \
  -d '{
    "model": "gpt-4o-mini",
    "stream": false,
    "messages": [
      {"role": "user", "content": "What is 2+2?"}
    ]
  }'
```

---

## 6. Streaming Rejection (stream=true)

```bash
curl http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4o-mini",
    "stream": true,
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

**Expected**: HTTP 400 with `unsupported_feature` error.
A `model_call` failure event is recorded with `error_code: UNSUPPORTED_STREAMING`.

---

## 7. Tool Trace CLI

```bash
# Read a local file
npm run trst1:tool -- read_file '{"path":"README.md"}'

# Expected output:
# Executing tool: read_file
# Args: {"path":"README.md"}
# Event recorded: evt_...
# Status: success
# Args hash: abc123...
# Result hash: def456...
# Latency: X ms
# Event hash: ...
```

---

## 8. Shadow Report Generation

```bash
npm run trst1:report

# Expected: .trustos/shadow-report.md is generated
# Console output summarizes the report
```

**Report must include**:
- Model calls observed
- Tool calls observed
- Total tokens
- Estimated cost
- Gateway overhead (avg, P50, P99)
- Top models
- Context blocks recorded
- Events captured
- Telemetry failures
- Coverage limitations
- MCP passthrough not implemented

---

## 9. Acceptance Criteria

| # | Criterion |
|---|---|
| 1 | Gateway starts locally and responds to health check |
| 2 | PM can call localhost `/v1/chat/completions` with real upstream key |
| 3 | Response is returned from real upstream provider |
| 4 | `model_call` event is appended to `.trustos/events.jsonl` |
| 5 | `stream=true` returns `unsupported_feature` error and records failure event |
| 6 | Tool Trace CLI records `tool_call` event |
| 7 | Shadow Report is generated from real event log |
| 8 | No raw prompt or raw tool args are stored in event log |
| 9 | `event_hash` exists for every event |
| 10 | TypeScript checks pass |
| 11 | All Out of Scope items are absent (no policy, DLP, approval, DB, UI) |

---

## 10. Out of Scope

- Real MCP Broker passthrough (deferred to TRST-1C)
- Policy enforcement
- Approval flow
- DLP detection, semantic or pattern-based
- Secrets injection
- Capability token enforcement
- DB migration
- UI changes
- Multi-tenant auth
- Production hardening
- Streaming support
- Model Scheduler
- Memory Manager
- Trust Card

---

## 11. Known Limitations

1. **Streaming**: Not supported. Clients must set `stream=false`.
2. **MCP passthrough**: Not implemented. Tool trace is CLI-only.
3. **Cost estimation**: Static price table. Unknown models return null.
4. **Token estimation**: Character-based approximation (~4 chars/token). `tiktoken` not used in Lite mode.
5. **Evidence chain**: `event_hash` is computed per-event. No `previous_event_hash` hash chain.
6. **No Merkle proof**: Events are append-only but not cryptographically linked.
7. **Single upstream**: One provider configured per Gateway instance.
8. **No auth on Gateway itself**: The Gateway is a local-only proxy without client authentication.
9. **JSONL only**: No PostgreSQL storage, no query interface.
10. **Not production-ready**: This is an MVP validation milestone.
