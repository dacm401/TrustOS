// MWT-7D — Browser Harness Smoke (live, browser bucket).
//
// Uses the Playwright harness (browser-harness.mts) driving the installed
// Chrome to ACTUALLY click Audit and Memory nav and assert the surfaces are
// visible — no fake PASS.
//
// Honest classification (shared taxonomy with MWT-7C):
//   - harness/Chrome channel missing        => ENV_BLOCKED
//   - frontend dev/preview server cannot start (env/port) => ENV_BLOCKED
//   - nav/surface selector missing          => FAIL
//   - console/hydration/page error          => FAIL
//   - all reachable, no runtime errors      => PASS
//
// No backend / DB / LLM / external network dependency. Audit/Memory surfaces
// are deterministic fixtures (verified: no fetch/useEffect on those components
// nor on the root page mount).

import { type ChildProcess, spawn } from "node:child_process";
import { request } from "node:http";
import {
  classifyBrowserSmoke,
  emptyReport,
  getSurfaceMarkers,
  isBrowserSmokeSkipped,
  type BrowserSmokeReport,
} from "./browser-smoke-utils.mts";
import {
  launchHarness,
  teardownHarness,
  driveAuditMemoryPath,
  harnessAvailable,
} from "./browser-harness.mts";

const FRONTEND_PORT = Number(process.env.MWT7D_FRONTEND_PORT ?? 3100);
const ROOT_URL = `http://127.0.0.1:${FRONTEND_PORT}/`;

function httpCheck(port: number, path = "/"): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: "127.0.0.1", port, path, method: "GET", timeout: 2000 }, (res) => {
      res.resume();
      resolve(res.statusCode !== undefined && res.statusCode < 500);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end();
  });
}

async function waitForServer(port: number, retries = 60, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    if (await httpCheck(port)) return true;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

function emit(report: BrowserSmokeReport): void {
  process.stdout.write(`\n=== MWT-7D Browser Harness Smoke Report ===\n`);
  process.stdout.write(`  status                : ${report.status}\n`);
  if (report.blocker) process.stdout.write(`  blocker               : ${report.blocker}\n`);
  if (report.detail) process.stdout.write(`  detail                : ${report.detail}\n`);
  process.stdout.write(`  browser_available     : ${report.browser_available}\n`);
  process.stdout.write(`  root_loaded           : ${report.root_loaded}\n`);
  process.stdout.write(`  audit_nav_found       : ${report.audit_nav_found}\n`);
  process.stdout.write(`  memory_nav_found      : ${report.memory_nav_found}\n`);
  process.stdout.write(`  audit_surface_visible : ${report.audit_surface_visible}\n`);
  process.stdout.write(`  memory_surface_visible: ${report.memory_surface_visible}\n`);
  process.stdout.write(`  runtime_errors        : ${report.runtime_errors.length}\n`);
  for (const e of report.runtime_errors) process.stdout.write(`    - ${e}\n`);
  process.stdout.write(`  markers               : ${JSON.stringify(getSurfaceMarkers())}\n`);
}

async function main(): Promise<void> {
  process.stdout.write(`MWT-7D browser harness smoke\n`);

  if (isBrowserSmokeSkipped()) {
    emit(emptyReport("SKIPPED", { detail: "MWT7C_BROWSER_SMOKE=skip" }));
    process.exit(0);
  }

  // 1. harness / Chrome channel available?
  const avail = await harnessAvailable();
  if (!avail.available) {
    const r = classifyBrowserSmoke({ mode: "BROWSER_UNAVAILABLE", reason: avail.reason });
    emit(emptyReport(r.status, { blocker: r.blocker, detail: r.detail }));
    process.exit(0);
  }

  // 2. frontend server: reuse if already up, else spawn `next dev`.
  const isWin = process.platform === "win32";
  const nextBin = isWin ? "node_modules\\.bin\\next.cmd" : "node_modules/.bin/next";
  let serverOwned = false;
  let serverProc: ChildProcess | null = null;
  const serverUp = await httpCheck(FRONTEND_PORT);
  if (!serverUp) {
    process.stdout.write(`  spawning next dev on :${FRONTEND_PORT}\n`);
    try {
      serverProc = spawn(
        isWin ? "cmd" : "node",
        isWin ? ["/c", nextBin, "dev", "-p", String(FRONTEND_PORT)] : [nextBin, "dev", "-p", String(FRONTEND_PORT)],
        { cwd: "frontend", stdio: "ignore", env: { ...process.env, PORT: String(FRONTEND_PORT) } },
      );
    } catch (spawnErr: any) {
      const r = classifyBrowserSmoke({ mode: "SERVER_UNAVAILABLE", reason: `cannot spawn next dev: ${spawnErr?.message ?? spawnErr}` });
      emit(emptyReport(r.status, { browser_available: true, blocker: r.blocker, detail: r.detail }));
      process.exit(0);
    }
    serverOwned = true;
    const ready = await waitForServer(FRONTEND_PORT);
    if (!ready) {
      serverProc?.kill("SIGKILL");
      const r = classifyBrowserSmoke({ mode: "SERVER_UNAVAILABLE", reason: `frontend dev server did not come up on :${FRONTEND_PORT} (port/env blocked)` });
      emit(emptyReport(r.status, { browser_available: true, blocker: r.blocker, detail: r.detail }));
      process.exit(0);
    }
  } else {
    process.stdout.write(`  reusing existing server on :${FRONTEND_PORT}\n`);
  }

  // 3. launch harness + drive the real UI
  let handle: Awaited<ReturnType<typeof launchHarness>> | null = null;
  try {
    handle = await launchHarness();
    const probe = await driveAuditMemoryPath(handle, getSurfaceMarkers(), ROOT_URL);

    if (!probe.auditNavFound) {
      const r = classifyBrowserSmoke({ mode: "AUDIT_NAV_MISSING" });
      emit(emptyReport(r.status, { browser_available: true, root_loaded: probe.rootLoaded, runtime_errors: [...handle.consoleErrors, ...handle.pageErrors] }));
      process.exit(0);
    }
    if (!probe.memoryNavFound) {
      const r = classifyBrowserSmoke({ mode: "MEMORY_NAV_MISSING" });
      emit(emptyReport(r.status, { browser_available: true, root_loaded: probe.rootLoaded, audit_nav_found: true, runtime_errors: [...handle.consoleErrors, ...handle.pageErrors] }));
      process.exit(0);
    }
    if (!probe.auditSurfaceVisible) {
      const r = classifyBrowserSmoke({ mode: "AUDIT_SURFACE_MISSING" });
      emit(emptyReport(r.status, { browser_available: true, root_loaded: probe.rootLoaded, audit_nav_found: true, memory_nav_found: true, runtime_errors: [...handle.consoleErrors, ...handle.pageErrors] }));
      process.exit(0);
    }
    if (!probe.memorySurfaceVisible) {
      const r = classifyBrowserSmoke({ mode: "MEMORY_SURFACE_MISSING" });
      emit(emptyReport(r.status, { browser_available: true, root_loaded: probe.rootLoaded, audit_nav_found: true, memory_nav_found: true, audit_surface_visible: true, runtime_errors: [...handle.consoleErrors, ...handle.pageErrors] }));
      process.exit(0);
    }

    const runtimeErrors = [...handle.consoleErrors, ...handle.pageErrors];
    if (runtimeErrors.length > 0) {
      const r = classifyBrowserSmoke({ mode: "HYDRATION_RUNTIME_ERROR", reason: runtimeErrors.join(" | ") });
      emit(emptyReport(r.status, {
        browser_available: true, root_loaded: probe.rootLoaded, audit_nav_found: true, memory_nav_found: true,
        audit_surface_visible: true, memory_surface_visible: true, runtime_errors: runtimeErrors,
      }));
      process.exit(0);
    }

    const r = classifyBrowserSmoke({ mode: "ALL_REACHABLE" });
    emit(emptyReport(r.status, {
      browser_available: true, root_loaded: probe.rootLoaded, audit_nav_found: true, memory_nav_found: true,
      audit_surface_visible: true, memory_surface_visible: true,
    }));
    process.exit(0);
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    // A thrown error during real driving indicates a genuine UI/runtime failure,
    // not an environment block — classify as FAIL (never ENV_BLOCKED, never PASS).
    const r = classifyBrowserSmoke({ mode: "ASSERTION_FAILED", reason: `harness driving error: ${msg.slice(0, 160)}` });
    emit(emptyReport(r.status, { browser_available: true, detail: msg.slice(0, 160) }));
    process.exit(0);
  } finally {
    if (handle) await teardownHarness(handle);
    if (serverOwned && serverProc) {
      try { serverProc.kill("SIGKILL"); } catch { /* ignore */ }
    }
  }
}

main();
