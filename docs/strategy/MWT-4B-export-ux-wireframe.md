# MWT-4B Export UX Wireframe (Documentation Only)

> **Status**: DRAFT — DOCUMENTATION_ONLY ✅ (wireframe text only, no UI code)
> Companion: `MWT-4B-export-scope-spec.md`, `MWT-4B-export-privacy-checklist.md`.

---

## 1. Export Button Candidate Position

- Located in the `TaskEvidenceView` header, right-aligned, beside the existing summary title.
- Label: **"导出快照"** (Export Snapshot).
- Icon: download-style glyph, muted (not primary CTA color).

## 2. Disabled State

- Disabled when:
  - No task selected.
  - Task selected but `event_count === 0` (empty evidence).
  - Evidence data still loading.
- Disabled style: 40% opacity, `cursor: not-allowed`, `aria-disabled="true"`.
- Tooltip on hover when disabled: **"暂无可导出的证据"** (No evidence available to export).

## 3. Empty Task State

- If user clicks export on a task with 0 events, show inline notice instead of download:
  **"该任务暂无证据事件，导出内容为空。"** (This task has no evidence events; export would be empty.)

## 4. Tooltip Copy

- Hover tooltip on the Export button:
  **"导出当前任务证据的客户端快照（未签名，不含原始内容）。"**
  (Export a client-side snapshot of this task's evidence — unsigned, no raw content.)

## 5. Confirmation Modal Copy

Title: **导出证据快照**
Body:
> 你将导出一个**客户端生成、未签名**的任务证据快照。
> 它是投影快照，**不是系统记录的认证**。
> 原始提示词与原始输出**已排除**。
> 导出的文件仅用于人工查看或流转，不具备认证效力。

Buttons: **取消** / **确认导出**

## 6. Unsigned Warning Banner

Rendered at top of the modal AND at top of the exported snapshot preview:

> ⚠️ **未签名快照** — 此导出由客户端生成，未经签名，不构成系统记录或认证。

Color: amber/muted warning, not red alarm.

## 7. No Raw Content Reminder

Below the warning banner:

> 原始提示词、原始输出、密钥与内部链路均已排除，仅包含哈希与元数据。

## 8. Exported Snapshot Preview

A read-only `<pre>` block showing the JSON from `MWT-4B-export-json-schema.md`, truncated to first N lines, with a **"复制 JSON"** (Copy JSON) affordance. No syntax highlighting that could imply verification.

Preview header: **快照预览（只读）**

## 9. Success / Error Copy

Success:
> ✅ 快照已生成。可复制 JSON 或下载文件（未签名）。

Error (e.g. serialization failure):
> ❌ 导出失败：快照生成出错，未写入任何文件。请联系支持。

No success message may claim "verified", "signed", "certified", or "attested".

---

## Required Canonical Copy (must appear verbatim in UI + payload notice)

> This export is client-generated and unsigned.
> It is a projection snapshot, not a system-of-record attestation.
> Raw prompts and raw outputs are excluded.

Chinese equivalent (UI):

> 此导出由客户端生成且未签名。它是投影快照，不是系统记录的认证。原始提示词与原始输出已排除。
