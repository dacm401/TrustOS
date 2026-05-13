/**
 * ArtifactRevisionIntent — 检测用户是否要求修改已有 Worker 产物。
 *
 * 只有 activeArtifact 存在时，才可能返回 true（否则没意义）。
 *
 * Context Boundary V1 之后，Manager 只读 brief 不读 artifact 全文。
 * 如果用户要求具体修改，Manager 不能直接回答修改后的结果，
 * 必须路由到 Worker 执行修订。
 */

import type { ActiveArtifactContext } from "./active-artifact.js";

// ── 阳性关键词（触发 revision） ─────────────────────────────────────────
// 注意：不要加过于通用的词如"这个页面"——它也会匹配"这个页面包含什么"

const REVISION_PATTERNS_ZH = [
  /修改/,
  /改成/,
  /换成/,
  /调整/,
  /优化/,
  /继续改/,
  /基于上[一版面个]/,
  /把它/,
  /上一版/,
  /刚才那个/,
  /改一下/,
  /修一下/,
  /重构/,
  /改一改/,
  /改改/,
];

const REVISION_PATTERNS_EN = [
  /\bchange\b/i,
  /\bmodify\b/i,
  /\bupdate\b/i,
  /\brevise\b/i,
  /\badjust\b/i,
  /make it/i,
  /turn it/i,
  /\bfix\b/i,
  /\brefactor\b/i,
  /\bimprove\b/i,
  /based on the previous/i,
];

// ── 阴性关键词（不触发 revision——这些只问不修改） ──────────────────────
// 注：问题词（哪些/什么/哪里）比"包含什么"/"是什么"宽，覆盖更多问句

const NON_REVISION_PATTERNS_ZH = [
  /解释/,
  /包含[哪些什么]/,
  /是什么/,
  /(哪些|什么|哪里)[组件功能部分]/,
  /为什么/,
  /总结/,
  /结构/,
  /怎么用/,
  /如何/,
  /什么意思/,
  /道理是什么/,
  /原理/,
  /说明/,
  /介绍一下/,
];

const NON_REVISION_PATTERNS_EN = [
  /explain/i,
  /what (is|are|does)/i,
  /why (is|are|does)/i,
  /summarize/i,
  /summary/i,
  /structure/i,
  /how (to|do|does)/i,
  /describe/i,
];

/**
 * 检测用户消息是否为已有 artifact 的修改请求。
 *
 * 规则：
 * 1. 无 activeArtifact → 返回 false
 * 2. 匹配阴性关键词（解释/总结） → 返回 false
 * 3. 匹配阳性关键词（修改/改成） → 返回 true
 * 4. 默认 → 返回 false（不猜测，宁少勿多）
 */
export function detectArtifactRevisionIntent(input: {
  latestUserMessage: string;
  activeArtifact?: ActiveArtifactContext;
}): boolean {
  const { latestUserMessage, activeArtifact } = input;

  // 没有 artifact 就不可能修改
  if (!activeArtifact) return false;

  const msg = latestUserMessage || "";

  // 阴性优先：解释类问句不走 revision
  for (const p of NON_REVISION_PATTERNS_ZH) {
    if (p.test(msg)) return false;
  }
  for (const p of NON_REVISION_PATTERNS_EN) {
    if (p.test(msg)) return false;
  }

  // 阳性匹配：修改类请求触发 revision
  for (const p of REVISION_PATTERNS_ZH) {
    if (p.test(msg)) return true;
  }
  for (const p of REVISION_PATTERNS_EN) {
    if (p.test(msg)) return true;
  }

  return false;
}

/**
 * Routing guard 纯函数。
 *
 * 在 routeWithManagerDecision 的 direct_answer 返回路径前调用。
 * 如果 activeArtifact 存在且用户要求修改，强制改为 delegate_to_slow。
 */
export function applyArtifactRevisionRoutingGuard(input: {
  originalAction: string;
  latestUserMessage: string;
  activeArtifact?: ActiveArtifactContext;
}): {
  finalAction: string;
  artifactRevisionIntent: boolean;
  overridden: boolean;
} {
  const artifactRevisionIntent = detectArtifactRevisionIntent({
    latestUserMessage: input.latestUserMessage,
    activeArtifact: input.activeArtifact,
  });

  if (input.activeArtifact && artifactRevisionIntent) {
    return {
      finalAction: "delegate_to_slow",
      artifactRevisionIntent: true,
      overridden: input.originalAction !== "delegate_to_slow",
    };
  }

  return {
    finalAction: input.originalAction,
    artifactRevisionIntent,
    overridden: false,
  };
}
