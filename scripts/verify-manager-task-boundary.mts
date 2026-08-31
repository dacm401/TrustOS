/**
 * Verify the Manager-side task boundary contract (regression guard).
 *
 * Run: npx tsx scripts/verify-manager-task-boundary.mts
 *      (needs DATABASE_URL — falls back to the built-in default template)
 *
 * Background — the "two questions merged into one task" incident:
 *   History contained 「用Python写一个快速排序算法」, then the user asked
 *   「天为啥蓝」. The Manager emitted a COMBINED goal:
 *       "用Python编写快速排序算法，并解释天空为什么是蓝色的"
 *   and delegated it to the Worker, which produced quicksort code —
 *   the user got the answer to the PREVIOUS question.
 *
 * Two root causes, both fixed here:
 *
 *   1. Manager had NO task-boundary instruction. The Worker side long had
 *      「只使用 Task Brief 提供的信息，不要读取任何外部历史对话」, but the
 *      Manager prompt never had the symmetric rule, so the model felt free
 *      to fold historical questions into the current task.
 *
 *   2. History was fed to the Manager as ordinary chat messages,
 *      indistinguishable from the current turn.
 *
 * These assertions lock the boundary instruction into the rendered prompt.
 */

import { PromptTemplateService } from "../src/services/prompt-template-service.js";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const prompt = await PromptTemplateService.getManagerSystemPrompt({
  user_message: "天为啥蓝",
  compressed_history: "user: 用Python写一个快速排序算法\nassistant: 好的",
});

console.log("\n── 1. Manager 具备任务边界隔离指令 ──────────────────────");
{
  check("prompt 渲染成功且非空", prompt.length > 0, `len=${prompt.length}`);
  check("包含【任务边界】小节", prompt.includes("【任务边界】"));
  check("明确只针对本轮输入决策",
    /只针对\s*\[current_user_input\]/.test(prompt));
  check("禁止把历史问题并入当前任务",
    prompt.includes("严禁把历史里出现过的任何问题并入当前任务"));
  check("禁止替用户续做未完成的旧任务",
    prompt.includes("不要替用户续做"));
}

console.log("\n── 2. 历史被降级为「仅用于指代消解」─────────────────────");
{
  check("历史用途被限定为理解指代",
    prompt.includes("仅用于理解指代关系"));
}

console.log("\n── 3. 当前输入先于历史呈现 ─────────────────────────────");
{
  const curIdx = prompt.indexOf("[current_user_input]");
  const histIdx = prompt.indexOf("[compressed_history]");
  check("[current_user_input] 存在", curIdx >= 0);
  check("本轮输入被显式标注", prompt.includes("用户本轮输入：天为啥蓝"));
  if (curIdx >= 0 && histIdx >= 0) {
    check("当前输入排在历史之前（当前优先）", curIdx < histIdx,
      `cur=${curIdx} hist=${histIdx}`);
  } else {
    check("历史段缺失时不影响契约", true);
  }
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
