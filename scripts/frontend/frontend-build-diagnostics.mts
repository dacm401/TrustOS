// MWT-7B — Frontend Build & Runtime Readiness diagnostics.
//
// Separates three concerns that the old "Frontend Build" bucket conflated:
//   1. typecheck_status  — real TypeScript errors MUST be FAIL
//   2. build_status      — PASS / FAIL / ENV_BLOCKED (narrow node-scheme classifier)
//   3. runtime_surface   — Audit + Memory route surfaces reachable (static)
//
// Honesty rules (per PM authorization):
//   - TypeScript errors                                → FAIL
//   - missing component import                         → FAIL
//   - missing Audit/Memory surface                    → FAIL
//   - known sandbox webpack/node scheme UnhandledScheme → ENV_BLOCKED
//   - unexpected build compile error                   → FAIL
//   - NO broad catch-all: unknown errors stay FAIL
//
// No backend. No real network dependency for the deterministic parts; the live
// `next build` is optional and its failure is classified honestly.

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Reuse the MWT-7 narrow env-blocker classifier.
import {
  isEnvBlockedError,
  classifyBlocker,
} from "../trst/env-diagnostics.ts";

export type FrontendStatus = "PASS" | "FAIL" | "ENV_BLOCKED";

export interface FrontendReadinessReport {
  typecheck_status: FrontendStatus;
  build_status: FrontendStatus;
  runtime_surface_status: FrontendStatus;
  import_boundary_status: FrontendStatus;
  import_boundary_violations: string[];
  audit_surface_present: boolean;
  memory_surface_present: boolean;
  audit_route_branch_present: boolean;
  memory_route_branch_present: boolean;
  typecheck_detail: string;
  build_detail: string;
  runtime_detail: string;
  diagnostics: string[];
}

// ── Paths (relative to trustos/) ──────────────────────────────────────────────

const FRONTEND_DIR = join(process.cwd(), "frontend");
const SIDEBAR = join(FRONTEND_DIR, "src", "components", "layout", "Sidebar.tsx");
const PAGE = join(FRONTEND_DIR, "src", "app", "page.tsx");
const AUDIT_SURFACE = join(FRONTEND_DIR, "src", "components", "audit", "AuditReviewSurface.tsx");
const MEMORY_SURFACE = join(FRONTEND_DIR, "src", "components", "memory", "MemoryGovernanceSurface.tsx");

// ── Helpers ─────────────────────────────────────────────────────────────────

function runTypecheck(): { status: FrontendStatus; detail: string } {
  if (!existsSync(join(FRONTEND_DIR, "tsconfig.json"))) {
    return { status: "FAIL", detail: "frontend/tsconfig.json missing" };
  }
  try {
    execSync("npx tsc --noEmit", {
      cwd: FRONTEND_DIR,
      encoding: "utf8",
      stdio: ["ignore", "ignore", "ignore"],
    });
    return { status: "PASS", detail: "npx tsc --noEmit: 0 errors" };
  } catch (err) {
    const detail = err instanceof Error && err.message ? err.message.slice(0, 400) : String(err);
    return { status: "FAIL", detail: `tsc errors present: ${detail}` };
  }
}

function runBuild(): { status: FrontendStatus; detail: string; blocker?: string } {
  if (!existsSync(join(FRONTEND_DIR, "package.json"))) {
    return { status: "FAIL", detail: "frontend/package.json missing" };
  }
  try {
    execSync("npx next build", {
      cwd: FRONTEND_DIR,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: "PASS", detail: "npx next build: compiled successfully" };
  } catch (err) {
    const stderr = extractStderr(err);
    return classifyBuildResult(stderr);
  }
}

/**
 * Pure classifier for a captured `next build` stderr. Exposed so tests can
 * assert build-status semantics WITHOUT executing the build (deterministic,
 * offline). Narrow: only known node-scheme / webpack-environment patterns are
 * ENV_BLOCKED; everything else is FAIL.
 */
export function classifyBuildResult(stderr: string): {
  status: FrontendStatus;
  detail: string;
  blocker?: string;
} {
  if (stderr.length === 0) {
    // No stderr but build threw — treat as unexpected FAIL, not env-blocked.
    return { status: "FAIL", detail: "next build failed with no captured stderr" };
  }
  if (isEnvBlockedError(stderr)) {
    return {
      status: "ENV_BLOCKED",
      detail: `next build blocked by environment: ${classifyBlocker(stderr)}`,
      blocker: classifyBlocker(stderr),
    };
  }
  // Unexpected compile error → FAIL (do NOT weaken, no catch-all).
  const snippet = stderr.split("\n").filter(Boolean).slice(-8).join(" | ").slice(0, 400);
  return { status: "FAIL", detail: `next build compile error: ${snippet}` };
}

function extractStderr(err: unknown): string {
  if (err && typeof err === "object") {
    const e = err as { stderr?: string; message?: string };
    if (typeof e.stderr === "string" && e.stderr.length) return e.stderr;
    if (typeof e.message === "string") return e.message;
  }
  return String(err ?? "");
}

function hasSurface(file: string): boolean {
  return existsSync(file);
}

function sidebarHasItem(): { audit: boolean; memory: boolean; detail: string } {
  if (!existsSync(SIDEBAR)) {
    return { audit: false, memory: false, detail: "Sidebar.tsx missing" };
  }
  const src = readFileSync(SIDEBAR, "utf8");
  const audit = /id:\s*["']audit["']/.test(src);
  const memory = /id:\s*["']memory["']/.test(src);
  return { audit, memory, detail: `sidebar audit=${audit} memory=${memory}` };
}

function pageHasBranches(): { audit: boolean; memory: boolean; detail: string } {
  if (!existsSync(PAGE)) {
    return { audit: false, memory: false, detail: "page.tsx missing" };
  }
  const src = readFileSync(PAGE, "utf8");
  // Detect branch wiring: the page renders the surface inside a conditional
  // branch keyed on activeNav === "audit" / "memory" (this codebase uses
  // `{activeNav === "x" && <Surface/>}`, not a switch/case).
  const audit = /activeNav\s*===\s*["']audit["']/.test(src) && /AuditReviewSurface/.test(src);
  const memory = /activeNav\s*===\s*["']memory["']/.test(src) && /MemoryGovernanceSurface/.test(src);
  return { audit, memory, detail: `page audit=${audit} memory=${memory}` };
}

// ── Import-boundary guard (MWT-7B review follow-up) ───────────────────────────
//
// Prevents recurrence of the exact bug class MWT-7B fixed: a frontend file
// statically importing a backend module that pulls Node built-ins into the
// client bundle (webpack UnhandledSchemeError). Two static checks, both
// deterministic and offline:
//   1. No frontend/src file may directly import `node:*` / `crypto` / `fs` /
//      `path` / `child_process` / `net` / `tls`.
//   2. No frontend/src file may import `src/services/**` (or any shared backend
//      gateway to it) whose target file itself imports a Node built-in.
//
// Returns the list of violations (empty array = PASS).

const FORBIDDEN_NODE_RE =
  /(?:from|import)\s+["'](?:node:(?:crypto|fs|path|child_process|net|tls|async_hooks)|crypto|fs|path|child_process|net|tls)["']/;
const REQUIRE_NODE_RE = /require\(\s*["'](?:node:(?:crypto|fs|path|child_process|net|tls)|crypto|fs|path|child_process|net|tls)["']\s*\)/;
// Matches a relative import escaping upward toward repo-root services, e.g.
// "../../../src/services/mwt6/memory-governance.ts"
const BACKEND_SERVICE_IMPORT_RE =
  /from\s+["']\.\.?\/.*?src\/services\/[^"']+["']/;

function walkTsFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readFileSyncList(dir)) {
    const full = join(dir, entry);
    if (isDir(full)) {
      walkTsFiles(full, acc);
    } else if (/\.(ts|tsx|js|jsx|mts)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

// Minimal directory read without pulling in extra deps.
import { readdirSync, statSync } from "node:fs";
function readFileSyncList(dir: string): string[] {
  return readdirSync(dir);
}
function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Deterministic import-boundary check. Returns violations; empty = safe.
 * Exported so tests can assert the guard without running the live build.
 */
export function checkFrontendImportBoundary(): string[] {
  const violations: string[] = [];
  const frontendSrc = join(FRONTEND_DIR, "src");
  const files = walkTsFiles(frontendSrc);

  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    // 1. direct Node-builtin import from a frontend file
    if (FORBIDDEN_NODE_RE.test(content) || REQUIRE_NODE_RE.test(content)) {
      violations.push(`FRONTEND_DIRECT_NODE_IMPORT: ${relativeToFrontend(file)}`);
      continue;
    }
    // 2. frontend importing a backend src/services module
    const match = content.match(BACKEND_SERVICE_IMPORT_RE);
    if (match) {
      const target = resolveBackendTarget(file, match[0]);
      if (target && existsSync(target) && backendModuleImportsNode(target)) {
        violations.push(
          `FRONTEND_IMPORTS_NODE_BACKEND: ${relativeToFrontend(file)} -> ${relativeToRepo(target)}`,
        );
      }
    }
  }
  return violations;
}

// Resolve a `../../../src/services/...` import specifier to an absolute path.
function resolveBackendTarget(fromFile: string, importStmt: string): string | null {
  const spec = importStmt.match(/["']([^"']+)["']/);
  if (!spec) return null;
  // spec[1] is relative to the directory of fromFile
  return joinSafe(dirnameOf(fromFile), spec[1]);
}
function dirnameOf(p: string): string {
  const i = p.replace(/\\/g, "/").lastIndexOf("/");
  return i === -1 ? "." : p.slice(0, i);
}
function joinSafe(base: string, rel: string): string {
  // Normalize relative path manually to avoid path.normalize edge cases.
  const parts = (base + "/" + rel).split("/");
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "." || part === "") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

function backendModuleImportsNode(target: string): boolean {
  let content: string;
  try {
    content = readFileSync(target, "utf8");
  } catch {
    return false;
  }
  return FORBIDDEN_NODE_RE.test(content) || REQUIRE_NODE_RE.test(content);
}

function relativeToFrontend(p: string): string {
  return p.replace(FRONTEND_DIR, "frontend").replace(/\\/g, "/");
}
function relativeToRepo(p: string): string {
  return p.replace(join(process.cwd()), "").replace(/\\/g, "/").replace(/^\//, "");
}

// ── Main diagnostic ───────────────────────────────────────────────────────────

export function runFrontendReadiness(): FrontendReadinessReport {
  const diagnostics: string[] = [];

  const tc = runTypecheck();
  if (tc.status === "FAIL") diagnostics.push("TYPECHECK_FAIL");

  const build = runBuild();
  if (build.status === "ENV_BLOCKED") diagnostics.push(`BUILD_ENV_BLOCKED(${build.blocker ?? "node-scheme"})`);
  if (build.status === "FAIL") diagnostics.push("BUILD_FAIL");

  const sb = sidebarHasItem();
  const pg = pageHasBranches();
  const auditSurface = hasSurface(AUDIT_SURFACE);
  const memorySurface = hasSurface(MEMORY_SURFACE);

  const surfacesOk = sb.audit && sb.memory && pg.audit && pg.memory && auditSurface && memorySurface;
  if (!surfacesOk) {
    diagnostics.push("RUNTIME_SURFACE_INCOMPLETE");
    if (!sb.audit) diagnostics.push("MISSING_SIDEBAR_AUDIT");
    if (!sb.memory) diagnostics.push("MISSING_SIDEBAR_MEMORY");
    if (!pg.audit) diagnostics.push("MISSING_AUDIT_ROUTE_BRANCH");
    if (!pg.memory) diagnostics.push("MISSING_MEMORY_ROUTE_BRANCH");
    if (!auditSurface) diagnostics.push("MISSING_AUDIT_SURFACE_FILE");
    if (!memorySurface) diagnostics.push("MISSING_MEMORY_SURFACE_FILE");
  }

  const runtime_status: FrontendStatus = surfacesOk ? "PASS" : "FAIL";

  // Import-boundary guard (MWT-7B review follow-up): no Node built-ins may leak
  // into the frontend bundle via direct import or via a backend module import.
  const boundaryViolations = checkFrontendImportBoundary();
  if (boundaryViolations.length) diagnostics.push("FRONTEND_IMPORT_BOUNDARY_VIOLATION");
  const import_boundary_status: FrontendStatus = boundaryViolations.length === 0 ? "PASS" : "FAIL";

  return {
    typecheck_status: tc.status,
    build_status: build.status,
    runtime_surface_status: runtime_status,
    import_boundary_status,
    import_boundary_violations: boundaryViolations,
    audit_surface_present: auditSurface,
    memory_surface_present: memorySurface,
    audit_route_branch_present: pg.audit,
    memory_route_branch_present: pg.memory,
    typecheck_detail: tc.detail,
    build_detail: build.detail,
    runtime_detail: `${sb.detail}; ${pg.detail}; auditFile=${auditSurface} memoryFile=${memorySurface}`,
    diagnostics,
  };
}

// ── CLI runner ────────────────────────────────────────────────────────────────

function main() {
  const report = runFrontendReadiness();
  console.log("=== MWT-7B Frontend Readiness ===");
  console.log(JSON.stringify(report, null, 2));
  const allPass =
    report.typecheck_status === "PASS" &&
    report.build_status === "PASS" &&
    report.runtime_surface_status === "PASS";
  console.log(allPass ? "OVERALL: READY" : "OVERALL: NOT READY");
}

// Run when executed directly (tsx). tsx resolves argv[1] inconsistently, so we
// always run main() at module top-level; this file is a CLI/diagnostics entry.
main();
