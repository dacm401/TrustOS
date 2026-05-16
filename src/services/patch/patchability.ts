/**
 * Sprint 62P: Patch-first Revision V0
 *
 * patchability.ts — 判定用户修订指令是否适合走 patch 路径。
 *
 * V0 规则（纯字符串匹配，简单即可）：
 * - patchable：颜色/字号/文案/间距/按钮/标题/标签等小调整
 * - non-patchable：重构/重设计/新功能/后端/数据库等大改动
 */

import type { PatchabilityDecision } from "./patch-types.js";

/** 可 patch 的小修订关键词（命中任一即可能 patchable） */
const PATCHABLE_KEYWORDS = [
  "改成", "改为", "变成",
  "改大", "改小",
  "蓝色", "红色", "绿色", "黄色", "白色", "黑色", "灰色",
  "颜色", "字号", "字体", "大小", "间距",
  "按钮", "标题", "标签",
  "换成", "修改", "调整",
  "加个", "添加",
];

/** 不可 patch 的大改动关键词（命中任一即 non-patchable） */
const NON_PATCHABLE_KEYWORDS = [
  "重写", "重构", "重新设计", "重新架构",
  "添加完整", "增加完整",
  "购物车", "电商", "后端", "数据库",
  "做成", "改成网站", "改成应用",
  "全套", "完整系统",
  "整个页面", "整体布局",
  "重新布局", "重新调整",
];

/**
 * 判定修订指令是否为可 patch 的小修订。
 *
 * @param instruction - 用户修订指令
 * @returns PatchabilityDecision
 */
export function isPatchableSmallEdit(
  instruction: string
): PatchabilityDecision {
  const text = instruction.trim().toLowerCase();

  // 先检查 non-patchable 关键词（大改动优先）
  for (const keyword of NON_PATCHABLE_KEYWORDS) {
    if (text.includes(keyword)) {
      return {
        patchable: false,
        reason: `Matched non-patchable keyword: "${keyword}"`,
        confidence: 0.95,
      };
    }
  }

  // 再检查 patchable 关键词
  let matchedKeyword: string | undefined;
  for (const keyword of PATCHABLE_KEYWORDS) {
    if (text.includes(keyword)) {
      matchedKeyword = keyword;
      break;
    }
  }

  if (matchedKeyword) {
    return {
      patchable: true,
      reason: `Matched patchable keyword: "${matchedKeyword}"`,
      confidence: 0.8,
      patchMode: determinePatchMode(matchedKeyword, text),
    };
  }

  // 没匹配上任何关键词，保守判定为不可 patch
  return {
    patchable: false,
    reason: "No patchable or non-patchable keywords matched; conservative fallback",
    confidence: 0.6,
  };
}

function determinePatchMode(
  keyword: string,
  fullText: string
): "style" | "text" | "small_structure" {
  const styleKeywords = [
    "颜色", "蓝色", "红色", "绿色", "黄色", "白色", "黑色", "灰色",
    "字号", "字体", "大小", "间距",
    "改成", "改为",
  ];
  const textKeywords = [
    "改成", "改为", "换成",
    "标题", "标签", "文案",
    "加个", "添加",
  ];

  const isStyle = styleKeywords.some((k) => fullText.includes(k));
  const isText = textKeywords.some((k) => fullText.includes(k));

  if (isStyle && isText) return "small_structure";
  if (isStyle) return "style";
  if (isText) return "text";
  return "small_structure";
}
