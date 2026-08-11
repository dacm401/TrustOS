# TRST-2: Gateway Production Readiness Charter

```text
TRST-2 Charter v0.2 — 2026-07-25
Status: IMPLEMENTED / AWAITING VALIDATION
Predecessors: TRST-1A/1B (CLOSED), TRST-1C (CLOSED)
```

## Motivation

TRST-1 validated Shadow Mode. TRST-2 makes it **usable by real agents**. Three gaps:

| Gap | Phase |
|-----|-------|
| No streaming — real agents use `stream=true` | TRST-2A |
| MCP lifecycle not proxied (only `tools/call`) | TRST-2B |
| Single upstream hardcoded | TRST-2C |

**Not policy/enforcement.** Pure Shadow Mode production readiness.

## TRST-2A: Streaming SSE Passthrough

- Accept `stream=true` on `/v1/chat/completions`
- SSE passthrough (real-time, no buffering)
- Accumulate stream for evidence event + token counting
- Record one `model_call` event after stream ends
- No raw content stored (hash only)
- **0 new npm dependencies** — native Web Streams API

Files: `openai-compatible-forwarder.ts` (add stream forward), `llm-gateway-server.ts` (replace 400 rejection), smoke test script.

## TRST-2B: MCP Lifecycle Methods

- Proxy `initialize`, `list_tools`, `list_resources` through MCP passthrough
- Unified into `/trst1/mcp` endpoint (route by method)
- Record `tool_call` events for lifecycle methods (event_type awareness)
- **0 new npm dependencies**

## TRST-2C: Multi-Provider Model Registry

- `TRUSTOS_MODELS_CONFIG` env / JSON config
- Model → provider routing (model name prefix matching)
- Provider abstraction: OpenAI-compatible, fallback
- Per-provider API key support
- Cost table per model for accurate estimation

## Key Invariants (unchanged from TRST-1)

1. Shadow Mode only — no blocking, no policy, no enforcement
2. No raw args/result stored (hash only)
3. `privacy_flags` empty
4. No new npm dependencies
5. `event_hash` on every event
6. Append-only event log
7. Response passthrough unmodified

## Validation

Each phase ships with smoke tests: `npm run trst2:stream-smoke`, `npm run trst2:mcp-lifecycle-smoke`.

## Status

| Phase | Status |
|-------|--------|
| TRST-2A Streaming | IMPLEMENTED (21/21 smoke PASS) |
| TRST-2B MCP Lifecycle | IMPLEMENTED (awaiting restart+test) |
| TRST-2C Model Registry | IMPLEMENTED (TSC clean) |
