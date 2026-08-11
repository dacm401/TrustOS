# TrustOS Evidence Report

**Generated:** 2026-08-05T07:58:32.095Z
**Report ID:** TRST4A-MSFSP6EG
**Mode:** Shadow (Dry-Run) — No Enforcement

---

## Executive Summary

- Model calls: 183 (streaming: 1, non-streaming: 11, unknown mode: 171)
- Tool calls: 16
- Total tokens: 150,932
- Estimated cost: $0.033722
- Failures: 51
- Hash coverage: 34%
- Sessions: 126
- Events: 201

---

## Evidence Integrity

| Metric | Value |
|---|---|
| Output hash coverage | 63/183 (34%) |
| Input hash coverage | 182/183 |
| Context blocks | 239 |
| Sessions | 126 |

---

## Control Decisions

| Decision | Count |
|---|---|
| Allow | 0 |
| Warn | 0 |
| Block | 0 |
| No Decision | 201 |

> TrustOS operates in Shadow Mode. All decisions are recommendations only — not enforced.

---

## Model Usage

| Model | Calls | Tokens | Est. Cost |
|---|---|---|---|
| `deepseek-ai/DeepSeek-V4-Flash` | 169 | 150,932 | $0.033722 |
| `nonexistent-model-xyz` | 13 | 0 | $0.000000 |
| `unknown` | 1 | 0 | $0.000000 |

## Gateway Performance

| Metric | Value |
|---|---|
| Avg overhead | 1877.69 ms |
| P50 | 2 ms |
| P99 | 27696 ms |

## Failures

- **model_call** (evt_mrli0aja_0003_4uk015): `UNSUPPORTED_STREAMING` — stream=true is not supported in TRST-1 MVP. Set stream=false.
- **model_call** (evt_mrybejsn_0001_t2tpcz): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_mrybeu14_0002_pulgrd): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_mrybfc2d_0003_2sdo0e): `UPSTREAM_404` — "Not Found"
- **tool_call** (evt_mryduxj2_0002_bpeew2): `-32602` — {"code":-32602,"message":"Unknown tool: nonexistent_tool"}
- **tool_call** (evt_mryduxj8_0003_d5vxx3): `INVALID_REQUEST` — jsonrpc must be "2.0"
- **tool_call** (evt_mryduxjb_0004_1k90ts): `INVALID_REQUEST` — Request body must be a JSON-RPC 2.0 object (batch not supported)
- **tool_call** (evt_mryduxjf_0005_uj59rk): `INVALID_REQUEST` — JSON-RPC id is required (notifications not supported)
- **tool_call** (evt_mrydv58h_0007_jfspn2): `-32602` — {"code":-32602,"message":"Unknown tool: nonexistent_tool"}
- **tool_call** (evt_mrydv58l_0008_ed07qt): `INVALID_REQUEST` — jsonrpc must be "2.0"
- **tool_call** (evt_mrydv58q_0009_8ga6qp): `INVALID_REQUEST` — Request body must be a JSON-RPC 2.0 object (batch not supported)
- **tool_call** (evt_mrydv58t_000a_yteagm): `INVALID_REQUEST` — JSON-RPC id is required (notifications not supported)
- **model_call** (evt_mrzzmatf_0003_mft5gh): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzmujn_0006_advw7x): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzno6f_0007_ojzeek): `STREAM_ERROR` — Invalid state: Controller is already closed
- **model_call** (evt_mrzzqfl5_000c_qa0oe2): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzqm99_000f_lyitk3): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzr6vh_000i_p92fe8): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzrrfz_000l_mu40oy): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzryw2_000o_81kgt4): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzsxff_000r_83lio5): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_mrzzu0q9_000u_ov4mpm): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_ms01yz8t_000x_uzm6gr): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_ms01zn0e_0010_258z9c): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_ms02kv9a_0003_g9iq6t): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **tool_call** (evt_ms02ur3e_0005_xh0lk2): `INVALID_REQUEST` — Unknown MCP method: "nonexistent_method"
- **model_call** (evt_ms02vjrx_0008_3fq1qu): `STREAM_HTTP_400` — {"code":20012,"message":"Model does not exist. Please check it carefully.","data":null}
- **model_call** (evt_ms8ag6hq_0001_82tobu): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8ah7tf_0001_vcfmbj): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8ah897_0002_1pdzib): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8ahl25_0001_xmkzgr): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8ahlid_0002_5up6mx): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8aui65_0001_tzc5ec): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8auilr_0002_opq53a): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8avquf_0001_ny2b4k): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8avraw_0002_pnwjrj): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8axstf_0001_1mik8g): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8axt8x_0002_rec4z7): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8azbp9_0001_mrzkdm): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8azc4r_0002_l7q313): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8azyq6_0001_3zej73): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_ms8azz60_0002_ec6p00): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_mse3v5zk_000p_9753wa): `UPSTREAM_503` — {"code":50508,"message":"System is too busy now. Please try again later.","data":null}
- **model_call** (evt_msfridhu_0001_coos01): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfriqx0_0002_dcfb4g): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfriv6p_0003_h2c9hw): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfsepx1_0004_p1cb17): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfser06_0005_ai34rf): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfsexle_0006_8l8a5x): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfsfldr_0007_00mq7s): `UPSTREAM_404` — "Not Found"
- **model_call** (evt_msfsnow6_0003_29xm5a): `UPSTREAM_ERROR` — fetch failed

---

## Privacy & Scope

- No raw model inputs/outputs stored — SHA-256 hashes only
- Tool calls: name + hash only, no raw arguments/results
- No user identity, IP addresses, or geolocation stored
- Failures: error codes only, no stack traces or credentials

## Known Limitations

- Streaming mode: supported (SSE) — validated for completed streams. Failed/cancelled streams recorded without output_hash by design. Not production-grade.
- Hash chain: not implemented (per-event hashing only)
- Digital signatures: not implemented
- Enforcement: shadow mode (dry-run) only
- Storage: flat JSONL file (database planned)

---

*Generated by TrustOS Gateway — TRST-4A Evidence Report. Shadow Mode. For internal review only.*
