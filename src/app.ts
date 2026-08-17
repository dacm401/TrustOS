/**
 * TrustOS Hono app construction (route wiring only).
 *
 * This module builds and exports the `app` WITHOUT starting any server or
 * background workers, so tests can import it and use `app.request()` for
 * in-process HTTP testing (S69P pattern) without side effects (no listen,
 * no slow-worker loop, no LLM connections).
 *
 * `src/index.ts` is the runtime entrypoint: it imports `app` from here and
 * calls `serve()` + starts the worker loops.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config.js";
import { identityMiddleware } from "./middleware/identity.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { chatRouter } from "./api/chat.js";
import { dashboardRouter } from "./api/dashboard.js";
import { taskRouter } from "./api/tasks.js";
import { memoryRouter } from "./api/memory.js";
import { evidenceRouter } from "./api/evidence.js";
import { healthRouter } from "./api/health.js";
import { archiveRouter } from "./api/archive.js";
// Sprint 48: Auth v1 — JWT token endpoint (public, no identity middleware)
import { authRouter } from "./api/auth.js";
// Sprint 62: Prompt Templates API
import { default as promptTemplatesRouter } from "./api/prompt-templates.js";
// Sprint 63: Sessions Summary API
import { sessionsRouter } from "./api/sessions.js";
// S78P: Human Review Resolution API
import { hrRouter } from "./api/human-review.js";
// Sprint 64: Permission-Gated Worker Architecture
import { createPermissionsRouter, createWorkspacesRouter } from "./api/permissions.js";
// S94P: Observability API
import { observabilityRouter } from "./api/observability.js";
// S97P: Beta feedback stats API
import { betaRouter } from "./api/beta.js";
// S98P: Beta Hardening — cost cap, quota, invite, admin
import { costCapMiddleware } from "./middleware/cost-cap.js";
import { quotaMiddleware } from "./middleware/quota.js";
import { betaInviteMiddleware } from "./middleware/beta-invite.js";
import { adminRouter } from "./api/admin.js";
// S100P: Agent Session & Manager Message API
import { agentSessionsRouter } from "./api/agent-sessions.js";
import { managerMessagesRouter } from "./api/manager-messages.js";
// MWT-14: ManagerConversation controller surface
import { managerConversationsRouter } from "./api/manager-conversations.js";
import { sessionEventsRouter } from "./api/session-events.js";
// S100P Phase 2: Manager Routing API
import { managerRouteRouter } from "./api/manager-route.js";
// MWT-22: Backend Assessment API (TRST-4D)
import { assessRouter } from "./api/assess.js";
// Optimization: Prometheus Metrics endpoint
import { metricsRouter } from "./api/metrics.js";

// S69P: export app for test access (Hono app.fetch enables in-process HTTP testing)
export const app = new Hono();

app.use("/*", cors());
// S98P: Beta invite check — runs before everything to block unauthorized access
app.use("/api/*", betaInviteMiddleware);
app.use("/v1/*", betaInviteMiddleware);
// P2-2: Rate limiting — runs before identity so even unauthenticated callers are throttled
app.use("/api/*", rateLimitMiddleware);
app.use("/v1/*", rateLimitMiddleware);
// C3a: mount identity middleware on all API routes
app.use("/api/*", identityMiddleware);
app.use("/v1/*", identityMiddleware);
// S98P: Cost cap + quota — run AFTER identity so userId is available
// Applied only to POST /api/chat (the expensive endpoint)
app.use("/api/chat", costCapMiddleware);
app.use("/api/chat", quotaMiddleware);
// H1: Runtime Health Dashboard — public, no identity middleware
app.route("/health", healthRouter);
// Sprint 48: Auth — public, no identity middleware (it's the login endpoint)
app.route("/auth", authRouter);
app.route("/api", chatRouter);
app.route("/api", dashboardRouter);
app.route("/v1/tasks", taskRouter);
app.route("/v1/memory", memoryRouter);
app.route("/v1/evidence", evidenceRouter);
app.route("/v1", archiveRouter);
app.route("/v1/prompt-templates", promptTemplatesRouter);
app.route("/v1/sessions", sessionsRouter);
app.route("/v1/human-review", hrRouter);  // S78P
app.route("/v1/observability", observabilityRouter);  // S94P
app.route("/v1/beta", betaRouter);  // S97P
app.route("/v1/permissions", createPermissionsRouter());
app.route("/v1/workspaces", createWorkspacesRouter());
app.route("/v1/admin", adminRouter);  // S98P: Admin health/usage/errors
// S100P: Agent Session & Manager Message API
app.route("/v1/agent-sessions", agentSessionsRouter);
app.route("/v1/manager-messages", managerMessagesRouter);
app.route("/v1/manager-conversations", managerConversationsRouter); // MWT-14
app.route("/v1/session-events", sessionEventsRouter);
// S100P Phase 2: Manager Routing API
app.route("/v1/manager", managerRouteRouter);
// MWT-22: Backend Assessment API (TRST-4D)
app.route("/v1/assess", assessRouter);
