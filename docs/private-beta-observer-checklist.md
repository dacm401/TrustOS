# TrustOS Private Beta — Observer Checklist

```text
Version: v0.1
Date: 2026-08-03
Purpose: Internal use — record reviewer experience without guiding them
```

---

## Observer Rules

1. **不要引导** — 除非 reviewer 被卡住超过 2 分钟且明确求助
2. **不要解释** — 不要解释 TrustOS 内部实现，除非 reviewer 明确询问
3. **记录原话** — 写下 reviewer 的真实表述，不是你的总结
4. **不纠正** — reviewer 的误解是产品信号，不要纠正（除非涉及 overclaim 风险）
5. **标注时间** — 记录每个关键时刻的大致时间戳

---

## Session Info

| Field | Value |
|---|---|
| Reviewer ID | |
| Reviewer Profile | AI Product / Governance / Security / Developer / Skeptical |
| Date | |
| Session Duration | |
| Observer Name | |
| Setup Method | (自有环境 / 提供环境) |

---

## Checklist

### Section A — Setup (Phase 1)

| # | Observer Item | Yes / No / N/A | Notes (reviewer 原话) |
|---:|---|---|---|
| A1 | Did reviewer complete git clone + npm install without help? | | |
| A2 | Did reviewer create `.env` without confusion? | | |
| A3 | Was the `.env` file format clear? | | |
| A4 | Any setup friction or questions? | | |

---

### Section B — Gateway (Phase 2)

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| B1 | Did gateway start on first try? | | |
| B2 | Did reviewer understand the startup output? | | |
| B3 | Did health check return HTTP 200? | | |
| B4 | Any gateway startup issues? | | |

---

### Section C — Test Request (Phase 3)

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| C1 | Did reviewer send the test request correctly? | | |
| C2 | Did reviewer notice `X-TrustOS-Trace-Id` header? | | |
| C3 | Did reviewer record the trace_id? | | |
| C4 | Any confusion about the response format? | | |

---

### Section D — Event Inspection (Phase 4)

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| D1 | Did reviewer understand trace_id? | | |
| D2 | Did reviewer find all hash fields (event/input/output)? | | |
| D3 | Did reviewer notice raw content is not in events? | | |
| D4 | Did reviewer understand the purpose of hashes? | | |
| D5 | Any confusion about event structure? | | |

---

### Section E — Risk Assessment (Phase 5)

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| E1 | Did reviewer understand low / medium / high risk? | | |
| E2 | Did reviewer find risk signals useful? | | |
| E3 | Did reviewer question any risk rating? | | |
| E4 | Did reviewer ask for more risk detail? | | |

---

### Section F — Dry-Run Control

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| F1 | Did reviewer understand dry-run = no blocking? | | |
| F2 | Did reviewer express that dry-run is acceptable? | | |
| F3 | Did reviewer ask for real enforcement? | | |
| F4 | Did reviewer seem confused about control mode? | | |
| F5 | Did reviewer misinterpret dry-run as enforcement? | | |

---

### Section G — Evidence Trust

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| G1 | Did reviewer understand evidence has no raw content? | | |
| G2 | Did reviewer trust the evidence format? | | |
| G3 | Did reviewer understand hash-based verification? | | |
| G4 | Did reviewer ask for signed/notarized evidence? | | |
| G5 | Did reviewer ask for raw content in evidence? | | |
| G6 | Did reviewer express privacy concern? | | |

---

### Section H — Limitations Awareness

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| H1 | Did reviewer read the limitations document? | | |
| H2 | Did reviewer understand what TrustOS does NOT do? | | |
| H3 | Did reviewer notice any missing limitation? | | |
| H4 | Did reviewer express any overclaim concern? | | |

---

### Section I — Product Language Scan

| # | Observer Item | Yes / No / N/A | Notes |
|---:|---|---|---|
| I1 | Did any TrustOS text seem to overclaim? | | |
| I2 | Did reviewer misinterpret a product capability? | | |
| I3 | Did reviewer think TrustOS blocks requests? | | |
| I4 | Did reviewer think identity is authenticated? | | |
| I5 | Did reviewer think evidence is legal-grade? | | |
| I6 | Did reviewer think dashboard = production? | | |
| I7 | Did reviewer express any misleading impression? | | |

---

### Section J — Overall Signals

| # | Observer Item | Notes |
|---:|---|
| J1 | Biggest moment of confusion (time + description) | |
| J2 | Biggest moment of clarity / satisfaction | |
| J3 | Did reviewer want to use TrustOS again? | |
| J4 | What did reviewer ask for most urgently? | |
| J5 | Any spontaneous quote worth preserving? | |
| J6 | Observer's overall impression (1 paragraph) | |

---

### Section K — Feedback Completion

| # | Observer Item | Yes / No | Notes |
|---:|---|
| K1 | Reviewer submitted feedback form? | | |
| K2 | Reviewer answered all structured questions? | | |
| K3 | Reviewer provided open-text feedback? | | |

---

## Observer Summary

完成 session 后，用 2–3 句话总结：

> (Reviewer) 在 _______ 环节最顺利。  
> 在 _______ 环节出现困惑。  
> 核心问题是：_______

---

## Escalation Triggers

如果以下任一项发生，**立即停止 session** 并联系 PM：

- [ ] Gateway 无法启动
- [ ] 响应暴露出原始 prompt 或 raw content
- [ ] 证据包含有不应暴露的敏感信息
- [ ] Reviewer 明确表示产品文案构成误导
- [ ] 任何疑似隐私或安全 incident

---

> **Status**: Observer Checklist — Ready (2026-08-03)  
> **Note**: 每个 session 使用一份副本，不要复用。
