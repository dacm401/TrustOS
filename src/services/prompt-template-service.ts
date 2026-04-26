/**
 * PromptTemplateService — Sprint 62（升级 Sprint 65）
 * 负责运行时加载/注入/组装 Manager Prompt 模板。
 *
 * 模板存于 DB（prompt_templates 表），运行时由 PromptTemplateRepo 读取。
 * 变量替换通过 render() 方法完成，将 context 注入模板字符串。
 *
 * Sprint 65 升级（参考 feishuclaw 架构）：
 *   - [security_and_permissions]: Fast 作为守门人的信息管控规则
 *   - [worker_delegation]: 何时创建工作空间 + 如何委托 Worker
 *   - [hooks_and_policies]: 生命周期钩子（on_permission_needed 等）
 *   - [core_rules]: 升级为管家/守门人视角
 */

import { PromptTemplateRepo } from "../db/repositories.js";
import type { PromptTemplate, PromptTemplateContent } from "../types/index.js";

export interface PromptRenderContext {
  /** 当前用户输入 */
  user_message: string;
  /** 压缩后的对话历史 */
  compressed_history?: string;
  /** 跨会话上下文摘要 */
  cross_session_context?: string;
  /** 当前任务摘要 */
  current_task?: string;
  /** 已完成步骤 */
  completed_steps?: string[];
  /** 未完成步骤 */
  blocked_by?: string[];
  /** 用户偏好摘要 */
  user_preference_summary?: string;
  /** session ID */
  session_id?: string;
  /** user ID */
  user_id?: string;
  /** 实时变量（如当前时间） */
  now?: string;
  /** Sprint 65: 待处理的权限请求（主人确认提示） */
  pending_permission_prompt?: string;
}

// ── Sprint 65 升级后的默认 Core Rules ──────────────────────────────────────────

const DEFAULT_CORE_RULES = [
  "你是 SmartRouter Manager，扮演主人（用户）的智能管家",
  "职责：正确理解主人意图 → 判断哪些工作自己做，哪些委托 Worker（Slow 模型）做",
  "快速/轻量任务（问答/起草/代码审查）→ 直接回答（Fast 层）",
  "复杂/外部/高风险任务（搜索/执行/金融/多步骤）→ 委托 Worker（Slow 层）",
  "始终与主人持续沟通，汇报进展，澄清意图，确认结果",
  "只输出 JSON，不要输出其他内容（回复主人的文字放在 direct_response.content 里）",
];

// ── 授权规则 ────────────────────────────────────────────────────────────────────

const DEFAULT_AUTH_RULES = {
  fast: [
    "纯文本问答、解释说明",
    "简单计算或格式转换",
    "代码审查/建议（不执行）",
    "文本起草初稿",
    "无副作用的分析推理",
    "用户偏好/简单回答",
  ],
  slow: [
    "实时 API 调用或网络搜索",
    "文件写入或执行操作",
    "代码执行（需沙箱环境）",
    "多步骤工作流",
    "深度推理或长链分析",
    "需要历史上下文的复杂任务",
    "跨会话续写或任务接续",
    "任何高风险操作（金融/安全/隐私）",
  ],
};

// ── 信息安全规则（Sprint 65 新增） ────────────────────────────────────────────

const DEFAULT_SECURITY_RULES = {
  blocked: [
    "密码 / API Key / Token / 私钥 → 绝对不传给 Worker",
    "证件号 / 护照号 / 银行卡号 → 绝对不传给 Worker",
  ],
  important: [
    "手机号 / 邮箱 / 姓名 / 地址 → 需主人确认才可授权给 Worker",
    "确认格式：回复 [允许 <请求ID前8位>] 或 [拒绝 <请求ID前8位>]",
  ],
  necessary: [
    "任务目标、日期、地点、偏好等无敏感信息的上下文 → 自动传给 Worker",
  ],
  principle: "Worker 只知道完成任务必需的信息，不多给一个字段",
};

// ── Worker 委托规则（Sprint 65 新增） ─────────────────────────────────────────

const DEFAULT_WORKER_DELEGATION = [
  "委托前：用简洁语言向主人说明 Worker 要做什么",
  "委托时：创建 TaskWorkspace，只写入脱敏后的 objective/constraints",
  "委托后：持续向主人汇报进展，不沉默",
  "结果回来后：先过滤/脱敏，再整合给主人",
  "多个 Worker 协作时：各 Worker 通过 TaskWorkspace 共享产出，Fast 统一调度",
];

// ── 生命周期钩子（Sprint 65 新增） ────────────────────────────────────────────

const DEFAULT_HOOKS: Record<string, string> = {
  on_permission_needed: "向主人发起授权确认请求，格式见 [security_and_permissions]",
  on_task_delegated: "立即回复主人「正在处理，请稍候」，不沉默",
  on_task_complete: "汇总 Worker 产出，脱敏，整合成主人友好的回复",
  on_task_blocked: "告知主人卡在哪里，并提供三个可选方案",
  on_sensitive_input: "如果主人输入了明显的敏感信息，提醒主人不要把密码/凭证直接发给我",
};

// ── 决策 Schema ─────────────────────────────────────────────────────────────────

const DEFAULT_DECISION_SCHEMA = {
  fields: ["schema_version", "decision_type", "routing_layer", "reason", "confidence", "needs_archive"],
  format: "json" as const,
  example: JSON.stringify({
    schema_version: "manager_decision_v1",
    decision_type: "direct_answer",
    routing_layer: "L0",
    reason: "简单问答，不需要工具或深度推理",
    confidence: 0.95,
    needs_archive: false,
    direct_response: { style: "concise", content: "..." },
  }, null, 2),
};

// ── 模式策略 ────────────────────────────────────────────────────────────────────

const DEFAULT_MODE_POLICY: Record<string, string> = {
  simple_qa: "直接回答，Fast 模型优先",
  tool_live: "检查是否需要实时数据，是则 → Slow",
  code_exec: "检查是否需要生成/执行代码，是则 → Slow",
  deep_reasoning: "强制 → Slow",
  multi_hop: "检查是否多步骤，是则 → Slow",
  cross_session: "检查是否依赖历史上下文，是则 → Slow 或加置信惩罚",
};

function buildDefaultContent(): PromptTemplateContent {
  return {
    core_rules: DEFAULT_CORE_RULES,
    mode_policy: DEFAULT_MODE_POLICY,
    decision_schema: DEFAULT_DECISION_SCHEMA,
    authorization_rules: DEFAULT_AUTH_RULES,
    security_and_permissions: DEFAULT_SECURITY_RULES,
    worker_delegation: DEFAULT_WORKER_DELEGATION,
    hooks: DEFAULT_HOOKS,
  };
}

// 内存缓存：避免每次请求都查 DB（TTL 60s）
let _cache: { template: PromptTemplate; expires: number } | null = null;
const CACHE_TTL_MS = 60_000;

function buildSystemPrompt(content: PromptTemplateContent, ctx: PromptRenderContext): string {
  const sections: string[] = [];

  // [core_rules]
  if (content.core_rules?.length) {
    sections.push("[core_rules]");
    content.core_rules.forEach((r) => sections.push(`- ${r}`));
  }

  // [mode_policy]
  if (content.mode_policy && Object.keys(content.mode_policy).length) {
    sections.push("\n[mode_policy]");
    for (const [mode, policy] of Object.entries(content.mode_policy)) {
      sections.push(`- ${mode}: ${policy}`);
    }
  }

  // [authorization_rules]
  if (content.authorization_rules) {
    const ar = content.authorization_rules;
    sections.push("\n[authorization_rules]");
    if (ar.fast?.length) {
      sections.push("- Fast 模型权限（直接处理）：");
      ar.fast.forEach((r) => sections.push(`  - ${r}`));
    }
    if (ar.slow?.length) {
      sections.push("- Slow 模型权限（委托 Worker）：");
      ar.slow.forEach((r) => sections.push(`  - ${r}`));
    }
  }

  // [security_and_permissions]（Sprint 65 新增）
  if (content.security_and_permissions) {
    const sp = content.security_and_permissions as typeof DEFAULT_SECURITY_RULES;
    sections.push("\n[security_and_permissions]");
    if (sp.blocked?.length) {
      sections.push("- 绝对禁止传给 Worker：");
      sp.blocked.forEach((r) => sections.push(`  - ${r}`));
    }
    if (sp.important?.length) {
      sections.push("- 需主人确认才可授权：");
      sp.important.forEach((r) => sections.push(`  - ${r}`));
    }
    if (sp.necessary?.length) {
      sections.push("- 自动授权（无需确认）：");
      sp.necessary.forEach((r) => sections.push(`  - ${r}`));
    }
    if (sp.principle) {
      sections.push(`- 原则：${sp.principle}`);
    }
  }

  // [worker_delegation]（Sprint 65 新增）
  if (content.worker_delegation && Array.isArray(content.worker_delegation) && content.worker_delegation.length) {
    sections.push("\n[worker_delegation]");
    (content.worker_delegation as string[]).forEach((r) => sections.push(`- ${r}`));
  }

  // [hooks_and_policies]（Sprint 65 新增）
  if (content.hooks && Object.keys(content.hooks).length) {
    sections.push("\n[hooks_and_policies]");
    for (const [name, handler] of Object.entries(content.hooks)) {
      sections.push(`- on_${name}: ${handler}`);
    }
  }

  // [pending_permissions]（运行时动态注入，由 chat.ts 传入）
  if (ctx.pending_permission_prompt) {
    sections.push("\n[pending_permissions]");
    sections.push(ctx.pending_permission_prompt);
  }

  // [current_user_input]
  sections.push("\n[current_user_input]");
  sections.push(`- 用户本轮输入：${ctx.user_message}`);

  if (ctx.compressed_history) {
    sections.push("\n[compressed_history]");
    sections.push(ctx.compressed_history);
  }

  if (ctx.cross_session_context) {
    sections.push("\n[cross_session_context]");
    sections.push(ctx.cross_session_context);
  }

  if (ctx.current_task) {
    sections.push("\n[task_summary]");
    sections.push(`- 当前任务：${ctx.current_task}`);
    if (ctx.completed_steps?.length) {
      sections.push("- 已完成：");
      ctx.completed_steps.forEach((s) => sections.push(`  - ${s}`));
    }
    if (ctx.blocked_by?.length) {
      sections.push("- 当前阻塞：");
      ctx.blocked_by.forEach((b) => sections.push(`  - ${b}`));
    }
  }

  // [decision_schema]
  if (content.decision_schema) {
    const ds = content.decision_schema;
    sections.push("\n[decision_schema]");
    sections.push(`- 必填字段：${ds.fields?.join(", ")}`);
    sections.push("- 输出格式：JSON");
    if (ds.example) sections.push(`- 示例：\n\`\`\`json\n${ds.example}\n\`\`\``);
  }

  return sections.join("\n");
}

export const PromptTemplateService = {
  /**
   * 获取当前激活的 Manager System Prompt（带缓存）。
   * 若 DB 无模板，返回内置默认模板。
   */
  async getManagerSystemPrompt(ctx: PromptRenderContext): Promise<string> {
    const now = Date.now();
    if (_cache && _cache.expires > now) {
      return buildSystemPrompt(_cache.template.content, ctx);
    }

    const template = await PromptTemplateRepo.getActive();
    if (template) {
      _cache = { template, expires: now + CACHE_TTL_MS };
      return buildSystemPrompt(template.content, ctx);
    }

    // 无模板 → 使用内置默认
    return buildSystemPrompt(buildDefaultContent(), ctx);
  },

  /**
   * 清除模板缓存（模板变更后调用）。
   */
  clearCache(): void {
    _cache = null;
  },

  /**
   * 变量插值替换（用于 content 字段内含 {{variable}} 的场景）。
   */
  interpolate(template: string, ctx: PromptRenderContext): string {
    return template
      .replace(/\{\{user_message\}\}/g, ctx.user_message)
      .replace(/\{\{session_id\}\}/g, ctx.session_id ?? "")
      .replace(/\{\{user_id\}\}/g, ctx.user_id ?? "")
      .replace(/\{\{now\}\}/g, ctx.now ?? new Date().toISOString())
      .replace(/\{\{current_task\}\}/g, ctx.current_task ?? "")
      .replace(/\{\{compressed_history\}\}/g, ctx.compressed_history ?? "")
      .replace(/\{\{cross_session_context\}\}/g, ctx.cross_session_context ?? "");
  },
};

