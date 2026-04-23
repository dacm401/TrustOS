# TA-003: Guardrail Policy Tests — Review

**Task Card:** TA-003 (Sprint 06)
**Status:** ✅ Done
**Commit:** pending

---

## Overview

TA-003 adds unit tests for `ToolGuardrail.validate()` — the pure policy enforcement layer
for external tool calls. No network, no orchestration, no executor — just rule assertions.

**Result:** 21 test cases, all passing. Full suite: **65/65**.

---

## What Was Tested

### Section A: `http_request` validation (11 cases)

| Case | Rule | Expected |
|------|------|----------|
| TA-003.1 | Missing `url` param | `allowed: false`, reason contains "'url' parameter is required" |
| TA-003.2 | Empty string `url` | `allowed: false`, same reason |
| TA-003.3 | Unparseable URL | `allowed: false`, reason contains "could not be parsed" |
| TA-003.4 | `http://` protocol | `allowed: false`, reason contains "HTTPS" |
| TA-003.5 | `ftp://` protocol | `allowed: false`, reason contains "HTTPS" |
| TA-003.6 | Host on non-empty allowlist | `allowed: true` |
| TA-003.7 | Host NOT on allowlist | `allowed: false`, reason includes host name |
| TA-003.8 | `Authorization` header present | `allowed: false`, `rejected_headers` includes "authorization" |
| TA-003.8b | `X-Api-Key` header (mixed case) | `allowed: false`, key check is case-insensitive |
| TA-003.8c | Safe headers (`Content-Type`, `Accept`) | `allowed: true`, no `rejected_headers` |
| TA-003.9 | Empty allowlist + valid HTTPS | `allowed: true` (fail-open when no list configured) |

### Section B: `web_search` validation (7 cases)

| Case | Rule | Expected |
|------|------|----------|
| TA-003.10 | Missing `query` param | `allowed: false` |
| TA-003.11 | Empty string query | `allowed: false` |
| TA-003.12 | Whitespace-only query | `allowed: false` |
| TA-003.13 | Query > 500 chars | `allowed: false`, reason includes "500" |
| TA-003.14 | Query at exactly 500 chars | `allowed: true` |
| TA-003.15 | `max_results: 50` (capped to 10) | `allowed: true`, console.log emits cap notice |
| TA-003.16 | Valid query + default max_results | `allowed: true` |

### Section C: System-wide rules (3 cases)

| Case | Rule | Expected |
|------|------|----------|
| TA-003.17 | Unknown external tool | `allowed: false`, reason includes tool name + "No guardrail policy found" |
| TA-003.18 | Trace written on allowed decision | `createTrace` called once, `type: "guardrail"`, `detail.allowed: true` |
| TA-003.18b | Trace written on rejected decision | `createTrace` called, `detail.allowed: false`, reason + details included |

---

## Test Architecture

**Mock dependencies:**

- `TaskRepo.createTrace` — mocked at module level via `vi.hoisted` + `vi.mock`. Trace writes
  are wrapped in try/catch in the source, but mocking keeps tests isolated and explicit.
- `config.guardrail` — re-imported per test via `import("../../src/config.js")` and mutated
  directly for allowlist/blockedHeaders variation. Reset in `finally` block.

**No network, no fetch, no executor.** This is the cleanest possible test surface:
- Input: `{ toolName, args, taskId, userId }`
- Output: `GuardrailResult`
- Assert: `allowed`, `reason`, `details.*`

---

## Policy Semantics Verified

### `http_request`

| Rule | Behavior |
|------|----------|
| Missing/empty URL | Reject immediately |
| Unparseable URL | Reject with parsed error |
| Non-HTTPS protocol | Reject — HTTPS only |
| Host allowlist | Empty = allow all (fail-open); non-empty = reject unknown |
| Blocked headers | Case-insensitive check against `authorization`, `cookie`, `set-cookie`, `x-api-key`, `x-auth-token` |

### `web_search`

| Rule | Behavior |
|------|----------|
| Empty/whitespace query | Reject |
| Query > 500 chars | Reject |
| `max_results > 10` | Cap to 10, log, allow |
| Default max_results | 5 (from `Number(undefined ?? 5)`) |

### Unknown tool

| Rule | Behavior |
|------|----------|
| Any unregistered external tool | `allowed: false`, "No guardrail policy found" — fail closed |

---

## Key Design Points

### 1. Fail-closed for unknown tools
The default case in the switch statement returns `allowed: false` for any tool not explicitly
handled. This means adding a new external tool without a guardrail policy is a hard failure,
not a silent passthrough.

### 2. Fail-open for allowlist
`config.guardrail.httpAllowlist` starts as `[]` (empty). The check is `if (allowlist.length > 0 && !allowlist.includes(host))`.
This means: no allowlist configured = all HTTPS hosts permitted.

### 3. Case-insensitive header blocking
`Object.keys(headers).map(k => k.toLowerCase()).includes(h)` — header keys are lowercased
before comparison against the blocked list, which is also lowercase.

### 4. `max_results` is capped, not rejected
`Math.min(maxResults, 10)` — values over 10 are silently capped with a console log. This
prevents DoS via excessive result counts without rejecting legitimate high-volume queries.

---

## Full Test Count

| Suite | Cases | Status |
|-------|-------|--------|
| TA-001 ExecutionLoop | 20 | ✅ |
| TA-002 ToolExecutor | 24 | ✅ |
| TA-003 ToolGuardrail | 21 | ✅ |
| **Total** | **65** | **✅** |

---

## Files Changed

- `backend/tests/services/tool-guardrail.test.ts` — 21 test cases
