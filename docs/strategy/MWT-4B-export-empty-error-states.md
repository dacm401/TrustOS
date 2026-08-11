# MWT-4B Export Empty / Error States

> **Status**: DOCUMENTATION_ONLY ✅ — empty & error UX copy, no code.
> **Companion**: `MWT-4B-export-copy-pack.md`, `MWT-4B-export-ux-wireframe.md`.
> **Last updated**: 2026-08-10

---

## E1 — No Task Selected

- Export button: disabled.
- Tooltip: **请先选择一个任务。**
- No modal opens.

## E2 — Empty Evidence (event_count = 0)

- Button: disabled OR click shows inline notice (decide at impl; copy below).
- Notice: **该任务暂无证据事件，导出内容为空。**
- If export still allowed (empty valid payload): preview shows valid JSON with empty `timeline`/`hashes` + warning "内容为空的合法快照".

## E3 — Loading State

- Button: disabled with spinner.
- Tooltip: **证据加载中…**
- No modal until data ready.

## E4 — Serialization Failure

- Modal closes; toast: **❌ 导出失败：快照生成出错，未写入任何文件。请联系支持。**
- No partial file written.

## E5 — Copy-to-Clipboard Failure

- Toast: **⚠️ 复制失败，请手动选择 JSON 文本。**
- Export itself succeeded; only clipboard failed.

## E6 — Download Blocked (if browser blocks Blob)

- Toast: **⚠️ 浏览器阻止了下载，已改为复制 JSON。**
- Fallback: copy JSON path.

## E7 — Missing session_id (optional field)

- Not an error. `session_id` key simply omitted.
- No warning shown (expected behavior).

## State Rules

- E1/E3: button disabled, no destructive action.
- E2: never throws; empty payload is valid.
- E4: atomic — either full export or none.
- No error copy may claim "verified/signed/certified".
