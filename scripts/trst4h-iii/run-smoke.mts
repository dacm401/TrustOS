/**
 * TRST-4H-III — Manager Route HTTP Adoption v0 — Smoke
 *
 * Verifies that src/api/manager-route.ts ACTUALLY adopts shapeManagerRouteResponse
 * so that ask_clarification reaches the real HTTP Manager route response.
 *
 * Strategy (lightweight, no DB / no server / no LLM):
 *   - The ask_clarification branch in manager-route.ts short-circuits BEFORE
 *     AgentSessionRepo.list() and before any Worker/LLM call, so we can drive the
 *     real Hono router via managerRouteRouter.request() with an X-User-Id header.
 *   - This exercises the actual HTTP path (not just the pure shaper).
 *
 * Run: npx tsx scripts/trst4h-iii/run-smoke.mts
 */

import { managerRouteRouter } from "../../src/api/manager-route.js";
import { routeMessage } from "../../src/services/manager-routing/manager-router.js";
import { shapeManagerRouteResponse } from "../../src/services/manager-routing/manager-route-response.js";
import type { ActiveSessionSummary } from "../../src/services/manager-routing/manager-routing-types.js";

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail = ""): void {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    console.log(`  ❌ ${name} ${detail}`);
  }
}

const noSessions: ActiveSessionSummary[] = [];

async function main(): Promise<void> {
  console.log("TRST-4H-III Manager Route HTTP Adoption — Smoke");

  // ── 1. Real HTTP route returns shaped clarification for underspecified prompt ──
  const res = await managerRouteRouter.request("/route-message", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-User-Id": "u" },
    body: JSON.stringify({ conversationId: "c1", message: "怎么弄？" }),
  });

  check("HTTP status 200 (not error)", res.status === 200, `(got ${res.status})`);
  const body = (await res.json()) as Record<string, unknown>;
  check("routeType is ask_clarification", body.routeType === "ask_clarification", `(got ${body.routeType})`);
  check("clarificationRequired true", body.clarificationRequired === true);
  const mm = body.managerMessage as Record<string, unknown> | null;
  check("managerMessage present", !!mm);
  check("managerMessage.role assistant", mm?.role === "assistant");
  check("managerMessage.content non-empty", typeof mm?.content === "string" && (mm.content as string).length > 0);
  check("createdSession null (no fake task id)", body.createdSession === null);
  check("targetSessionId null", body.targetSessionId === null);
  check("clarificationRequired !== undefined", body.clarificationRequired !== undefined);

  // ── 2. Honest, non-blaming clarification wording ──
  check(
    "clarification message is honest (no error wording)",
    /补充|了解更多信息|具体/.test((mm?.content as string) ?? ""),
  );

  // ── 3. Router still routes normal/delegated (regression guard) ──
  const rNormal = routeMessage({ user_id: "u", conversation_id: "c", message: "你好", target_session_id: null, active_sessions: noSessions });
  check("router: 你好 → normal_conversation", rNormal.route_type === "normal_conversation", `(got ${rNormal.route_type})`);
  const rDeleg = routeMessage({ user_id: "u", conversation_id: "c", message: "请用3、4、9、10拼出24点", target_session_id: null, active_sessions: noSessions });
  check("router: 24点 → new_delegated_task", rDeleg.route_type === "new_delegated_task", `(got ${rDeleg.route_type})`);
  const respDeleg = shapeManagerRouteResponse(rDeleg, "u");
  check("shaper: delegated createdSession not null (real task suggested)", respDeleg.createdSession !== null);
  check("shaper: delegated clarificationRequired false", respDeleg.clarificationRequired === false);

  console.log(`\nSmoke: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
