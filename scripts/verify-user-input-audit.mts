/**
 * Verify the ADR-004 user_input audit-field contract (regression guard).
 *
 * Run: npx tsx scripts/verify-user-input-audit.mts
 *
 * Background — the incident:
 *   User asked 「天为啥蓝」 and received quicksort code. The archive's
 *   user_input was 「好的，正在为您生成快速排序代码并解释天空为什么是蓝色的，
 *   请稍候...」 — a Manager-generated pleasantry, not the user's words.
 *
 * Why not just rely on the type system:
 *   Making `verbatimUserInput` a required field stops OMISSIONS (compile error),
 *   but cannot stop someone passing the WRONG value (e.g. `message` or
 *   `userFacingText`). These source-level assertions cover that gap.
 *
 * Deliberate trade-off: this is a source-text scan, so it is brittle against
 * refactors. That is acceptable — the cost of a false alarm (rename a variable,
 * update one regex) is far lower than the cost of the regression it prevents
 * (a Manager pleasantry silently becoming the task spec again). Every pattern
 * below is anchored on a comment marker or a distinctive token, not formatting.
 */

import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, detail?: string) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

const ROUTER = readFileSync("src/services/llm-native-router.ts", "utf8");
const WORKER = readFileSync("src/services/phase3/slow-worker-loop.ts", "utf8");
const REPO = readFileSync("src/db/task-archive-repo.ts", "utf8");
const TYPES = readFileSync("src/types/task.ts", "utf8");

// Strip line comments so "// user_input: message" can't satisfy a pattern,
// and so commented-out legacy code doesn't create false negatives.
const stripComments = (s: string): string =>
  s.split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

console.log("\n── 1. 审计字段的语义已被声明 ───────────────────────────");
{
  check("types/task.ts 定义 AuditUserInput 类型",
    /export type AuditUserInput\s*=/.test(TYPES));
  // The doc block sits ABOVE `export type AuditUserInput`, so look backwards
  // from the declaration rather than forwards.
  const declIdx = TYPES.indexOf("export type AuditUserInput");
  const preceding = declIdx > 0 ? TYPES.slice(Math.max(0, declIdx - 1600), declIdx) : "";
  check("AuditUserInput 的文档块说明「不得作为任务输入」",
    /不得作为任何 agent 的任务输入/.test(preceding),
    "缺少 ADR-004 的关键约束说明");
  check("AuditUserInput 的文档块说明「不得由模型输出派生」",
    /不得由任何模型输出派生/.test(preceding));
  check("TaskArchiveRecord.user_input 使用 AuditUserInput",
    /user_input:\s*AuditUserInput\s*;/.test(TYPES));
}

console.log("\n── 2. 写入边界接受单独的原话参数 ───────────────────────");
{
  check("writeTaskArchiveAndCommand 有 verbatimUserInput 参数",
    /verbatimUserInput\?:\s*string/.test(ROUTER));
  check("create() 的 user_input 参数标注为 AuditUserInput",
    /user_input:\s*AuditUserInput\s*;/.test(REPO));
  // The audit field must NOT be assigned straight from `message`.
  const code = stripComments(ROUTER);
  check("不再直接写 user_input: message",
    !/user_input:\s*message\b/.test(code),
    "审计字段不得直接取任务描述 message");
  check("审计字段取 auditInput（由 verbatimUserInput 派生）",
    /user_input:\s*auditInput\b/.test(code));
}

console.log("\n── 3. 所有调用点都传了用户原话 ─────────────────────────");
{
  const code = stripComments(ROUTER);
  // Exclude the declaration (`async function writeTaskArchiveAndCommand(`).
  const calls = [...code.matchAll(/await writeTaskArchiveAndCommand\(/g)].length;
  // 2 call sites in routeByDecision (delegate_to_slow / execute_task).
  check(`writeTaskArchiveAndCommand 调用点数量为 2（实际 ${calls}）`, calls === 2);
  // 3 sites consume ctx.verbatimUserInput: the 2 worker delegations plus the
  // ask_clarification archive. All must use the verbatim value, never ctx.message.
  const passing = [...code.matchAll(/ctx\.verbatimUserInput/g)].length;
  check(`3 处归档写入都传 ctx.verbatimUserInput（实际 ${passing}）`, passing === 3);

  check("routeByGatedDecision 的两处入口都注入 verbatimUserInput",
    [...code.matchAll(/verbatimUserInput:\s*message\b/g)].length >= 2);
}

console.log("\n── 4. 上下文接口把「原话」与「任务描述」分开 ───────────");
{
  // Required (no `?`) means an omission is a compile error — TypeScript's
  // contribution to this contract.
  check("GatedRouteContext.verbatimUserInput 为必填（非可选）",
    /verbatimUserInput:\s*string\s*;/.test(ROUTER),
    "若为可选字段，遗漏调用点时类型系统无法拦截");
  const optionalDecl = [...ROUTER.matchAll(/verbatimUserInput\?:\s*string/g)].length;
  check("verbatimUserInput 仅在 writeTaskArchiveAndCommand 为可选（容错降级）",
    optionalDecl === 1, `发现 ${optionalDecl} 处可选声明`);
}

console.log("\n── 5. Worker 侧不再消费 user_input ────────────────────");
{
  const code = stripComments(WORKER);
  check("TaskContract.userInstruction 不再读 archive.user_input",
    !/userInstruction:\s*archive\?\.user_input/.test(code));
  check("userInstruction 改为读 envelope（goal / task_brief）",
    /userInstruction:\s*payload_json\.goal\s*\|\|/.test(code));
  check("已移除读取 user_input 的死函数 loadArchiveContext",
    !/async function loadArchiveContext/.test(code));
  // Belt and braces: nothing in the worker loop should read the audit field.
  check("slow-worker-loop 中不存在 archive.user_input 读取",
    !/archive\??\.user_input/.test(code),
    "Worker 不得读取 L0 审计字段");
}

console.log("\n── 6. 缺失原话时会告警（可观测的降级）──────────────────");
{
  check("verbatimUserInput 缺失时打 [adr-004] 告警",
    /\[adr-004\][\s\S]{0,200}verbatimUserInput/.test(ROUTER) ||
    /verbatimUserInput[\s\S]{0,400}\[adr-004\]/.test(ROUTER),
    "降级路径必须可观测，否则遗漏的调用点会静默污染");
}

console.log(`\n${fail === 0 ? "✅ ALL PASS" : "❌ FAILURES"}: ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
