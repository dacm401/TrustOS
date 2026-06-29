// Sprint 60P: Execution Policy Layer
// Policy-first Router: 规则先于 LLM 调用做决策
// 原则：绕过昂贵思考，不绕过安全管控

import type { ExecutionPolicyDecision, ExecutionPolicyRoute } from "../../types/call-ledger.js";
import type { ActiveArtifactContext } from "../context/active-artifact.js";

/**
 * 检测明确的 artifact 修订意图。
 * 规则：active artifact 存在 + 明确修订动词 + 不含"新建"类关键词
 */
function detectArtifactRevisionIntent(message: string): boolean {
  const trimmed = message.trim();

  // 明确修订动词（中文 + 英文）
  const revisionVerbs = [
    // 中文
    "改", "调整", "换", "变成", "改成", "调大", "调小",
    "放大", "缩小", "大一点", "小一点", "加", "减",
    "移动", "旋转", "删除", "移除", "增加", "减少",
    "修改", "改动", "重做", "再做一次",
    // 英文
    "change", "adjust", "modify", "update", "fix", "fix the",
    "make it", "turn it", "color", "colour", "bigger", "smaller",
    "larger", "smaller", "wider", "narrower", "taller", "shorter",
    "increase", "decrease", "add", "remove", "delete",
  ];

  // 明确排除词（新建类）
  const excludeWords = [
    "新建", "重新建", "另做", "再做一", "再写一", "另写",
    "写一个", "做一个", "创建", "新写",
    "new page", "new component", "new artifact", "create new",
    "build a new", "another", "different",
  ];

  const hasRevisionVerb = revisionVerbs.some((v) => trimmed.includes(v));
  const hasExcludeWord = excludeWords.some((w) => trimmed.toLowerCase().includes(w.toLowerCase()));

  return hasRevisionVerb && !hasExcludeWord;
}

/**
 * 检测明确的 artifact 新建意图。
 * 规则：包含"新建"类明确句式
 */
function detectArtifactCreateIntent(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  const createPatterns = [
    "写一个", "做一个", "帮我写", "帮我做", "帮我创建",
    "新建", "新做", "重新做", "重新写", "另做",
    "再写一个", "再做一个", "再来一个",
    "生成一个", "创建一个", "编写一个", "制作一个",
    "write a", "create a", "build a", "make a",
    "generate a", "generate a new", "another", "different component",
  ];

  // S96P: Broader artifact creation patterns — detect "生成/创建/编写 + artifact keyword"
  const artifactKeywords = ["html", "页面", "网页", "网站", "登录页", "首页", "组件", "component", "page", "website"];
  const hasArtifactKeyword = artifactKeywords.some((k) => trimmed.includes(k));
  const artifactCreateVerbs = ["生成", "创建", "编写", "制作", "开发", "generate", "create", "build", "develop", "code"];
  const hasArtifactCreateVerb = artifactCreateVerbs.some((v) => trimmed.includes(v));

  // 明确排除：已存在 artifact 的修订
  // 规则：有具体修订对象（按钮/标题/输入框）时才排除；"页面"需要配合修订动词才排除
  // "新建一个页面" 不应该被排除
  const revisionPatterns = [
    "再改一下", "再调整", // 明确修订
  ];
  // "页面" 只有在前面有修订动词时才排除（"改页面"），但"写一个页面"/"创建一个页面" 是新建
  // S95P fix: "按钮"/"标题" 不再无条件视为修订对象。只有当它们出现在明确修订语境中（如"改按钮"、"调整标题"）
  // 才触发 hasRevisionContext。单独的 "帮我写一个按钮"/"帮我创建一个标题" 是新建意图。
  const revisionObjectWords = ["按钮", "标题", "输入框", "颜色", "字体", "布局", "背景"];
  const hasRevisionObjectInContext = revisionObjectWords.some((w) => {
    if (!trimmed.includes(w)) return false;
    // 检查是否有修订动词修饰该词（改/调整/修改/换/变 + 按钮/标题等）
    return /[改调修换变][\u4e00-\u9fa5]{0,2}(按钮|标题|输入框|颜色|字体|布局|背景)/.test(trimmed);
  });
  const hasRevisionContext = revisionPatterns.some((p) => trimmed.includes(p)) ||
    hasRevisionObjectInContext ||
    (trimmed.includes("页面") && /[改调换变]页面|把.*页面|[把将].*页/.test(trimmed));

  // S96P: Broader detection — create verb + artifact keyword (e.g. "生成一个登录页 HTML")
  const hasBroadCreateIntent = hasArtifactCreateVerb && hasArtifactKeyword && !hasRevisionContext;

  return (createPatterns.some((p) => trimmed.includes(p)) || hasBroadCreateIntent) && !hasRevisionContext;
}

/**
 * 检测可由本地元数据直接回答的问题（不调任何模型）。
 */
function detectLocalAnswerIntent(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  const localAnswerPatterns = [
    "刚才生成的是哪个", "当前 artifact", "上一个版本",
    "现在有哪些 artifact", "有几个页面", "创建了多少",
    "which artifact", "current artifact", "last version",
  ];

  return localAnswerPatterns.some((p) => trimmed.includes(p));
}

/**
 * 评估执行策略。
 * 规则先于 LLM：确定性规则命中的任务不走 Manager LLM。
 *
 * 原则：绕过昂贵思考，不绕过安全管控。
 * 即使 bypass Manager LLM，Context Boundary 和 provenance 仍然执行。
 */
export function evaluateExecutionPolicy(
  message: string,
  activeArtifact?: ActiveArtifactContext,
  memoryWasRetrieved?: boolean,
): ExecutionPolicyDecision {
  const trimmed = message.trim();

  // ── 规则 1：明确修订 → 绕过 Manager LLM，直发 Worker ──
  if (activeArtifact && detectArtifactRevisionIntent(trimmed)) {
    return {
      route: "direct_artifact_revision",
      reason: `activeArtifact exists (${activeArtifact.artifactId}), revision verb detected: "${trimmed}"`,
      confidence: 0.95,
      managerLlmRequired: false,
      workerRequired: true,
      securityScope: "artifact_source_only",
      costTier: "medium",
      latencyTier: "fast",
    };
  }

  // ── 规则 2：明确新建 artifact → 绕过 Manager LLM（或仅用轻量判断）──
  if (detectArtifactCreateIntent(trimmed)) {
    return {
      route: "direct_create_artifact",
      reason: `create artifact intent detected: "${trimmed}"`,
      confidence: 0.85,
      managerLlmRequired: false,
      workerRequired: true,
      securityScope: "minimal_task_contract",
      costTier: "medium",
      latencyTier: "normal",
    };
  }

  // ── 规则 3：本地元数据可回答 → 不调任何模型 ──
  if (detectLocalAnswerIntent(trimmed)) {
    return {
      route: "local_answer_from_meta",
      reason: `local meta query detected: "${trimmed}"`,
      confidence: 0.9,
      managerLlmRequired: false,
      workerRequired: false,
      securityScope: "local_only",
      costTier: "free",
      latencyTier: "instant",
    };
  }

  // ── 兜底：需要 Manager LLM ──
  return {
    route: "manager_llm_required",
    reason: "no fast-path rule matched, routing to Manager LLM for decision",
    confidence: 1.0,
    managerLlmRequired: true,
    workerRequired: false,
    securityScope: "redacted_remote",
    costTier: "medium",
    latencyTier: "slow",
  };
}
