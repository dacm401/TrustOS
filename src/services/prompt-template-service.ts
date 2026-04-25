/**
 * PromptTemplateService — Sprint 62
 * 负责运行时加载/注入/组装 Manager Prompt 模板。
 *
 * 模板存于 DB（prompt_templates 表），运行时由 PromptTemplateRepo 读取。
 * 变量替换通过 render() 方法完成，将 context 注入模板字符串。
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
}

const DEFAULT_CORE_RULES = [
  "你是 SmartRouter Manager，专职决定用户请求该由哪个模型处理",
  "快速任务 → Fast 模型；复杂推理/多步 → Slow 模型",
  "不确定时优先委托，用户的耐心比模型成本贵",
  "只输出 JSON，不要输出其他内容",
];

const DEFAULT_MODE_POLICY: Record<string, string> = {
  simple_qa: "直接回答，Fast 模型优先",
  tool_live: "检查是否需要实时数据，是则 → Slow",
  code_exec: "检查是否需要生成/执行代码，是则 → Slow",
  deep_reasoning: "强制 → Slow",
  multi_hop: "检查是否多步骤，是则 → Slow",
  cross_session: "检查是否依赖历史上下文，是则 → Slow 或加置信惩罚",
};

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

const DEFAULT_AUTH_RULES = {
  fast: [
    "纯文本问答",
    "简单计算或格式转换",
    "无副作用的查询",
    "用户偏好类简单回答",
  ],
  slow: [
    "API 调用或实时数据查询",
    "文件写入或执行操作",
    "多步推理或深度分析",
    "需要历史上下文的复杂任务",
    "跨会话续写或任务接续",
  ],
};

function buildDefaultContent(): PromptTemplateContent {
  return {
    core_rules: DEFAULT_CORE_RULES,
    mode_policy: DEFAULT_MODE_POLICY,
    decision_schema: DEFAULT_DECISION_SCHEMA,
    authorization_rules: DEFAULT_AUTH_RULES,
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
      sections.push("- Fast 模型权限：");
      ar.fast.forEach((r) => sections.push(`  - ${r}`));
    }
    if (ar.slow?.length) {
      sections.push("- Slow 模型权限：");
      ar.slow.forEach((r) => sections.push(`  - ${r}`));
    }
  }

  // [current_context]
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

  // [hooks]（预留）
  if (content.hooks && Object.keys(content.hooks).length) {
    sections.push("\n[hooks]");
    for (const [name, handler] of Object.entries(content.hooks)) {
      sections.push(`- on_${name}: ${handler}`);
    }
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
   * 当前模板用 section 注入，暂不需要复杂插值，保留接口备用。
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
