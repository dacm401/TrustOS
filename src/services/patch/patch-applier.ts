/**
 * Sprint 62P: Patch-first Revision V0
 *
 * applyPatchPlan — 将 PatchPlan 应用到源代码。
 *
 * V0 规则：
 * 1. find 必须在 source 中唯一命中（未命中 / 多次命中 → 失败）
 * 2. replace / insert 后 content 必须非空
 * 3. 所有操作失败 → patch 失败
 * 4. patch 失败 → 由调用方 fallback full rewrite
 */

import type { PatchPlan, PatchResult } from "./patch-types.js";

/**
 * 将 PatchPlan 应用到源代码。
 *
 * @param source - 原始 artifact 内容
 * @param patchPlan - Worker 输出的 patch 计划
 * @returns PatchResult — ok 表示完全成功
 */
export function applyPatchPlan(
  source: string,
  patchPlan: PatchPlan
): PatchResult {
  const errors: string[] = [];
  let content = source;
  let appliedCount = 0;

  for (let i = 0; i < patchPlan.operations.length; i++) {
    const op = patchPlan.operations[i];

    // 规则 1: find 必须在 source 中唯一命中
    const idx = content.indexOf(op.find);
    const lastIdx = content.lastIndexOf(op.find);

    if (idx === -1) {
      errors.push(
        `Operation #${i + 1} (${op.op}) failed: find string "${truncate(op.find, 40)}" not found in source`
      );
      continue;
    }

    if (idx !== lastIdx) {
      errors.push(
        `Operation #${i + 1} (${op.op}) failed: find string "${truncate(op.find, 40)}" matched ${countOccurrences(content, op.find)} times (must be exactly 1)`
      );
      continue;
    }

    // 执行操作
    try {
      switch (op.op) {
        case "replace":
          content = content.replace(op.find, op.replace);
          break;
        case "insert_after":
          content =
            content.substring(0, idx + op.find.length) +
            op.insert +
            content.substring(idx + op.find.length);
          break;
        case "insert_before":
          content =
            content.substring(0, idx) + op.insert + content.substring(idx);
          break;
      }
      appliedCount++;
    } catch (e: any) {
      errors.push(
        `Operation #${i + 1} (${op.op}) execution error: ${e.message}`
      );
    }
  }

  // 规则 2: patch 后 content 必须非空
  if (!content || content.trim().length === 0) {
    errors.push("Patch result is empty after all operations");
    return {
      ok: false,
      content: undefined,
      errors,
      appliedOperations: appliedCount,
      totalOperations: patchPlan.operations.length,
      sourceBytes: source.length,
      outputBytes: 0,
    };
  }

  const ok = errors.length === 0;

  return {
    ok,
    content: ok ? content : undefined,
    errors: errors.length > 0 ? errors : undefined,
    appliedOperations: appliedCount,
    totalOperations: patchPlan.operations.length,
    sourceBytes: source.length,
    outputBytes: content.length,
  };
}

function countOccurrences(str: string, sub: string): number {
  let count = 0;
  let pos = 0;
  while (true) {
    const idx = str.indexOf(sub, pos);
    if (idx === -1) break;
    count++;
    pos = idx + 1;
  }
  return count;
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.substring(0, max) + "...";
}
