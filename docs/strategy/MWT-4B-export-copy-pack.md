# MWT-4B Export Copy Pack

> **Status**: DOCUMENTATION_ONLY ✅ — all UI strings, no UI code.
> **Companion**: `MWT-4B-export-ux-wireframe.md`, `MWT-4B-export-user-warning-copy.md`, `MWT-4B-export-empty-error-states.md`.
> **Last updated**: 2026-08-10
> **Language**: Chinese (UI) + English (payload notice, canonical).

---

## Button & Labels

- Export button: **导出快照**
- Disabled tooltip: **暂无可导出的证据**
- Hover tooltip: **导出当前任务证据的客户端快照（未签名，不含原始内容）。**

## Confirmation Modal

- Title: **导出证据快照**
- Body:
  > 你将导出一个**客户端生成、未签名**的任务证据快照。
  > 它是投影快照，**不是系统记录的认证**。
  > 原始提示词与原始输出**已排除**。
  > 导出的文件仅用于人工查看或流转，不具备认证效力。
- Cancel: **取消**
- Confirm: **确认导出**

## Unsigned Warning Banner

> ⚠️ **未签名快照** — 此导出由客户端生成，未经签名，不构成系统记录或认证。

## No-Raw-Content Reminder

> 原始提示词、原始输出、密钥与内部链路均已排除，仅包含哈希与元数据。

## Snapshot Preview

- Header: **快照预览（只读）**
- Action: **复制 JSON**

## Success / Error

- Success: **✅ 快照已生成。可复制 JSON 或下载文件（未签名）。**
- Error: **❌ 导出失败：快照生成出错，未写入任何文件。请联系支持。**

## Canonical English Notice (must appear in payload + UI)

> This export is client-generated and unsigned. It is a projection snapshot, not a system-of-record attestation. Raw prompts and raw outputs are excluded.

## Forbidden Copy Patterns

- ❌ "verified" / "已验证"
- ❌ "signed" / "已签名" (except explicit "unsigned / 未签名")
- ❌ "certified" / "已认证" (except explicit "not a certification")
- ❌ "approved by policy" / "策略已批准"
- ❌ "system of record" / "系统记录" (except explicit "not a system of record")
