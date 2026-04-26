// Sprint 67 — D1: PromptTemplate E2E Integration Tests
/**
 * D1: PromptTemplate E2E — Sprint 67
 *
 * 覆盖端到端路径：
 *   1. CRUD: create → getById → list → update → delete
 *   2. Activation: setActive 互斥（同一 scope 同时只有一个 active）
 *   3. Service render: getManagerSystemPrompt() 正确注入各字段
 *   4. Cache invalidation: activate 后缓存清空
 *
 * Infrastructure: vitest.api.config.ts (独立进程，vitest.api.config.ts)
 */

import { Hono } from "hono";
import { PromptTemplateRepo } from "../../src/db/repositories.js";
import { PromptTemplateService } from "../../src/services/prompt-template-service.js";
import { truncateTables } from "../db/harness.js";
import promptTemplateRouter from "../../src/api/prompt-templates.js";

const TEST_USER = "d1-test-user";
const TEST_SESSION = "d1-test-session";

const testApp = new Hono();
testApp.route("/v1/prompt-templates", promptTemplateRouter);

async function parseJson(res: Response) {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return text; }
}

function makeReq(path: string, init: RequestInit = {}, userId = TEST_USER) {
  const url = path.includes("?")
    ? `${path}&user_id=${encodeURIComponent(userId)}`
    : `${path}?user_id=${encodeURIComponent(userId)}`;
  return testApp.request(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
  });
}

// ── Shared fixtures ──────────────────────────────────────────────────────────

const SAMPLE_CONTENT = {
  core_rules: ["你是 SmartRouter Manager", "测试核心规则"],
  mode_policy: { simple_qa: "直接回答" },
  decision_schema: {
    fields: ["schema_version", "decision_type"],
    example: '{"schema_version":"v1","decision_type":"direct_answer"}',
  },
  authorization_rules: { fast: ["纯问答"], slow: ["搜索", "执行"] },
  security_and_permissions: {
    blocked: ["密码", "API Key"],
    important: ["手机号"],
    necessary: ["任务目标"],
    principle: "最小权限",
  },
  worker_delegation: ["委托前说明", "脱敏后传递"],
  hooks: { on_task_complete: "汇报" },
};

beforeEach(async () => {
  await truncateTables();
  PromptTemplateService.clearCache();
});

// ── CRUD ─────────────────────────────────────────────────────────────────────

describe("PromptTemplate API — CRUD", () => {
  it("POST creates a template and returns 201", async () => {
    const res = await makeReq("/v1/prompt-templates", {
      method: "POST",
      body: JSON.stringify({ name: "D1 Test Template", content: SAMPLE_CONTENT }),
    });
    expect(res.status).toBe(201);
    const body = await parseJson(res);
    expect(body.template).toBeDefined();
    expect(body.template.id).toBeDefined();
    expect(body.template.name).toBe("D1 Test Template");
    expect(body.template.is_active).toBe(false);
    expect(body.template.scope).toBe("global");
    expect(body.template.version).toBe(1);
  });

  it("POST without name returns 400", async () => {
    const res = await makeReq("/v1/prompt-templates", {
      method: "POST",
      body: JSON.stringify({ content: SAMPLE_CONTENT }),
    });
    expect(res.status).toBe(400);
  });

  it("GET /:id returns the created template", async () => {
    const create = await makeReq("/v1/prompt-templates", {
      method: "POST",
      body: JSON.stringify({ name: "Get By Id Test", content: SAMPLE_CONTENT }),
    });
    const { template } = await parseJson(create);

    const res = await makeReq(`/v1/prompt-templates/${template.id}`);
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.template.name).toBe("Get By Id Test");
  });

  it("GET /:id for nonexistent id returns 404", async () => {
    const res = await makeReq("/v1/prompt-templates/nonexistent-uuid");
    expect(res.status).toBe(404);
  });

  it("GET / lists all templates", async () => {
    await PromptTemplateRepo.create({ name: "T1", content: SAMPLE_CONTENT });
    await PromptTemplateRepo.create({ name: "T2", content: SAMPLE_CONTENT });

    const res = await makeReq("/v1/prompt-templates");
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.templates.length).toBeGreaterThanOrEqual(2);
    const names = body.templates.map((t: { name: string }) => t.name);
    expect(names).toContain("T1");
    expect(names).toContain("T2");
  });

  it("PUT /:id updates fields and increments version", async () => {
    const { template } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "Original Name", content: SAMPLE_CONTENT }),
      })
    );

    const res = await makeReq(`/v1/prompt-templates/${template.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: "Updated Name", content: { ...SAMPLE_CONTENT, core_rules: ["Modified"] } }),
    });
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.template.name).toBe("Updated Name");
    expect(body.template.version).toBe(2);
  });

  it("DELETE /:id removes the template", async () => {
    const { template } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "To Delete", content: SAMPLE_CONTENT }),
      })
    );

    const delRes = await makeReq(`/v1/prompt-templates/${template.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const getRes = await makeReq(`/v1/prompt-templates/${template.id}`);
    expect(getRes.status).toBe(404);
  });
});

// ── Activation ───────────────────────────────────────────────────────────────

describe("PromptTemplate API — Activation", () => {
  it("activate sets is_active=true and clears other active in same scope", async () => {
    const { template: t1 } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "T1", scope: "global", content: SAMPLE_CONTENT }),
      })
    );
    const { template: t2 } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "T2", scope: "global", content: SAMPLE_CONTENT }),
      })
    );
    const { template: t3 } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "T3", scope: "user_specific", content: SAMPLE_CONTENT }),
      })
    );

    // Activate T1 (global scope)
    const act1 = await makeReq(`/v1/prompt-templates/${t1.id}/activate`, { method: "POST" });
    expect(act1.status).toBe(200);
    expect((await parseJson(act1)).template.is_active).toBe(true);

    // Activate T2 (same scope → T1 should deactivate)
    const act2 = await makeReq(`/v1/prompt-templates/${t2.id}/activate`, { method: "POST" });
    expect(act2.status).toBe(200);
    expect((await parseJson(act2)).template.is_active).toBe(true);

    // T1 should now be inactive
    const t1After = await PromptTemplateRepo.getById(t1.id);
    expect(t1After!.is_active).toBe(false);

    // T3 (different scope) should still be inactive
    const t3After = await PromptTemplateRepo.getById(t3.id);
    expect(t3After!.is_active).toBe(false);

    // GET /active returns T2
    const activeRes = await makeReq("/v1/prompt-templates/active?scope=global");
    expect(activeRes.status).toBe(200);
    const activeBody = await parseJson(activeRes);
    expect(activeBody.template.name).toBe("T2");
  });

  it("GET /active returns null when no active template", async () => {
    await truncateTables();
    const res = await makeReq("/v1/prompt-templates/active");
    expect(res.status).toBe(200);
    const body = await parseJson(res);
    expect(body.template).toBeNull();
  });
});

// ── Service render ───────────────────────────────────────────────────────────

describe("PromptTemplateService — Render", () => {
  it("returns built-in defaults when no active template", async () => {
    await truncateTables();
    PromptTemplateService.clearCache();

    const prompt = await PromptTemplateService.getManagerSystemPrompt({
      user_message: "今天天气怎么样？",
    });

    expect(prompt).toContain("SmartRouter Manager");
    expect(prompt).toContain("今天天气怎么样？");
    expect(prompt).toContain("[core_rules]");
    expect(prompt).toContain("[decision_schema]");
  });

  it("injects cross_session_context when provided", async () => {
    await truncateTables();
    const { template } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "Render Test", content: SAMPLE_CONTENT }),
      })
    );
    await PromptTemplateRepo.setActive(template.id);
    PromptTemplateService.clearCache();

    const prompt = await PromptTemplateService.getManagerSystemPrompt({
      user_message: "继续之前的工作",
      cross_session_context: "用户上周在做一个数据分析任务，已完成 70%",
    });

    expect(prompt).toContain("cross_session_context");
    expect(prompt).toContain("数据分析任务");
    expect(prompt).toContain("继续之前的工作");
  });

  it("injects current_task / completed_steps / blocked_by", async () => {
    const prompt = await PromptTemplateService.getManagerSystemPrompt({
      user_message: "下一步怎么走",
      current_task: "写季度报告",
      completed_steps: ["收集数据", "整理图表"],
      blocked_by: ["等财务数据"],
    });

    expect(prompt).toContain("写季度报告");
    expect(prompt).toContain("收集数据");
    expect(prompt).toContain("等财务数据");
  });

  it("pending_permission_prompt section appears when set", async () => {
    const prompt = await PromptTemplateService.getManagerSystemPrompt({
      user_message: "查一下我的余额",
      pending_permission_prompt: "⚠️ 请确认是否允许查询余额",
    });

    expect(prompt).toContain("pending_permissions");
    expect(prompt).toContain("余额");
  });

  it("interpolate replaces {{variable}} placeholders", () => {
    const result = PromptTemplateService.interpolate(
      "用户：{{user_message}}，会话：{{session_id}}，时间：{{now}}",
      {
        user_message: "hello",
        session_id: "sess-123",
        now: "2026-04-26T12:00:00Z",
      }
    );
    expect(result).toContain("用户：hello");
    expect(result).toContain("会话：sess-123");
    expect(result).toContain("2026-04-26");
  });

  it("clearCache forces re-fetch from DB", async () => {
    const { template } = await parseJson(
      await makeReq("/v1/prompt-templates", {
        method: "POST",
        body: JSON.stringify({ name: "Cache Test", content: SAMPLE_CONTENT }),
      })
    );
    await PromptTemplateRepo.setActive(template.id);

    // First call — populates cache
    const prompt1 = await PromptTemplateService.getManagerSystemPrompt({ user_message: "x" });
    expect(prompt1).toContain("Cache Test");

    // Update template in DB
    await PromptTemplateRepo.update(template.id, {
      content: { ...SAMPLE_CONTENT, core_rules: ["Updated after cache"] },
    });

    // Without clear — should still return cached value
    const prompt2 = await PromptTemplateService.getManagerSystemPrompt({ user_message: "x" });
    expect(prompt2).toContain("Cache Test"); // still old

    // With clear — should return new value
    PromptTemplateService.clearCache();
    const prompt3 = await PromptTemplateService.getManagerSystemPrompt({ user_message: "x" });
    expect(prompt3).toContain("Updated after cache");
  });
});
