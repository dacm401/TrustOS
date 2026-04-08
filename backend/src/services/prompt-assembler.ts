/**
 * PromptAssembler v1
 *
 * Centralizes prompt construction for ChatService.
 * Supports direct and research modes.
 * Future extension points: memory_context, evidence_context, budget_rules.
 */

export type PromptMode = "direct" | "research";

export interface PromptAssemblyInput {
  mode: PromptMode;
  userMessage: string;
  taskSummary?: {
    goal?: string | null;
    summaryText?: string | null;
    nextStep?: string | null;
  };
}

export interface PromptSections {
  core_rules: string;
  mode_policy: string;
  task_summary?: string;
  user_request: string;
}

export interface PromptAssemblyOutput {
  systemPrompt: string;
  userPrompt: string;
  sections: PromptSections;
}

// ── Section builders ──────────────────────────────────────────────────────────

function buildCoreRules(): string {
  return [
    "You are SmartRouter Pro, an intelligent AI assistant.",
    "Respond accurately and helpfully.",
    "Do not fabricate information.",
    "Format responses clearly.",
    "The conversation may include compressed history summaries — use them naturally as context.",
  ].join("\n");
}

function buildModePolicy(mode: PromptMode): string {
  if (mode === "direct") {
    return [
      "Mode: direct",
      "- Answer directly and concisely.",
      "- Do not expand into complex research flows unless explicitly required.",
      "- Prefer low-cost, clear responses.",
    ].join("\n");
  }

  // research
  return [
    "Mode: research",
    "- Prioritize structured analysis over quick answers.",
    "- Clearly state assumptions before drawing conclusions.",
    "- Explain your reasoning path when relevant.",
    "- It is acceptable to be more verbose when thoroughness adds value.",
  ].join("\n");
}

function buildTaskSummarySection(taskSummary: PromptAssemblyInput["taskSummary"]): string | undefined {
  if (!taskSummary) return undefined;
  const { goal, summaryText, nextStep } = taskSummary;
  if (!goal && !summaryText && !nextStep) return undefined;

  const lines: string[] = ["Task context:"];
  if (goal) lines.push(`- Goal: ${goal}`);
  if (summaryText) lines.push(`- Summary: ${summaryText}`);
  if (nextStep) lines.push(`- Next step: ${nextStep}`);
  return lines.join("\n");
}

// ── Main assembler ────────────────────────────────────────────────────────────

export function assemblePrompt(input: PromptAssemblyInput): PromptAssemblyOutput {
  const { mode, userMessage, taskSummary } = input;

  const sections: PromptSections = {
    core_rules: buildCoreRules(),
    mode_policy: buildModePolicy(mode),
    user_request: userMessage,
  };

  const taskSummarySection = buildTaskSummarySection(taskSummary);
  if (taskSummarySection) {
    sections.task_summary = taskSummarySection;
  }

  // Assemble system prompt from sections
  const systemParts: string[] = [sections.core_rules, sections.mode_policy];
  if (sections.task_summary) {
    systemParts.push(sections.task_summary);
  }
  const systemPrompt = systemParts.join("\n\n");

  return {
    systemPrompt,
    userPrompt: userMessage,
    sections,
  };
}
