/**
 * Prompt Templates API — Sprint 62
 * CRUD for prompt_templates table.
 * 模板供 Manager 运行时注入 system prompt。
 */

import { Hono } from "hono";
import { PromptTemplateRepo } from "../db/repositories.js";
import type { PromptTemplateInput, PromptTemplateUpdate } from "../types/index.js";

const app = new Hono();

/** GET /api/prompt-templates — 列表 */
app.get("/", async (c) => {
  const scope = c.req.query("scope") as string | undefined;
  const templates = await PromptTemplateRepo.list(scope);
  return c.json({ templates });
});

/** GET /api/prompt-templates/active — 当前激活模板 */
app.get("/active", async (c) => {
  const scope = (c.req.query("scope") as string) || "global";
  const template = await PromptTemplateRepo.getActive(scope);
  return c.json({ template });
});

/** GET /api/prompt-templates/:id */
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const t = await PromptTemplateRepo.getById(id);
  if (!t) return c.json({ error: "not found" }, 404);
  return c.json({ template: t });
});

/** POST /api/prompt-templates — 创建 */
app.post("/", async (c) => {
  const body = await c.req.json<PromptTemplateInput & { created_by?: string }>();
  if (!body.name || !body.content) {
    return c.json({ error: "name and content required" }, 400);
  }
  const t = await PromptTemplateRepo.create(body);
  return c.json({ template: t }, 201);
});

/** PUT /api/prompt-templates/:id */
app.put("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json<PromptTemplateUpdate>();
  const t = await PromptTemplateRepo.update(id, body);
  if (!t) return c.json({ error: "not found" }, 404);
  return c.json({ template: t });
});

/** POST /api/prompt-templates/:id/activate — 激活指定模板（同 scope 其他模板自动关闭） */
app.post("/:id/activate", async (c) => {
  const id = c.req.param("id");
  await PromptTemplateRepo.setActive(id);
  const t = await PromptTemplateRepo.getById(id);
  // clear service cache so next request picks up new active template
  const { PromptTemplateService } = await import("../services/prompt-template-service.js");
  PromptTemplateService.clearCache();
  return c.json({ template: t });
});

/** DELETE /api/prompt-templates/:id */
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await PromptTemplateRepo.delete(id);
  return c.json({ ok: true });
});

export default app;