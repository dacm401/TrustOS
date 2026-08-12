// MWT-7C — Browser Smoke / UI Runtime Probe v0 (live, browser bucket).
//
// Goal (PM): verify the frontend can load, navigate to Audit and Memory
// surfaces, and report runtime/hydration failures honestly.
//
// Repo reality: NO Playwright/Puppeteer dependency exists. Per MWT-7C
// authorization ("If no browser harness: implement a lightweight runtime probe
// / static fallback, but must mark browser runtime unavailable = ENV_BLOCKED,
// cannot fake PASS"), this script:
//
//   1. probes whether a browser runtime is available in THIS environment
//   2. if NOT available  -> ENV_BLOCKED (honest, never PASS)
//   3. if SKIP requested  -> SKIPPED
//   4. if available       -> would run the real nav + surface + error checks
//                            (structured here; gated on a real harness existing)
//
// It NEVER requires backend / DB / LLM / external network. It asserts the
// surface markers (data-testid) exist so a future real-browser pass can rely
// on them. The deterministic offline assertions about markers live in the
// regression script; this LIVE script only runs the runtime probe.

import {
  classifyBrowserSmoke,
  detectBrowserRuntime,
  emptyReport,
  isBrowserSmokeSkipped,
  getSurfaceMarkers,
  type BrowserSmokeReport,
} from "./browser-smoke-utils.mts";
import { isEnvBlocked, isFail, isPass, isSkipped } from "../trst/validation-status.ts";

function emit(report: BrowserSmokeReport): void {
  process.stdout.write(`\n=== MWT-7C Browser Smoke Report ===\n`);
  process.stdout.write(`  status                : ${report.status}\n`);
  if (report.blocker) process.stdout.write(`  blocker               : ${report.blocker}\n`);
  if (report.detail) process.stdout.write(`  detail                : ${report.detail}\n`);
  process.stdout.write(`  browser_available     : ${report.browser_available}\n`);
  if (report.browser_engine) process.stdout.write(`  browser_engine        : ${report.browser_engine}\n`);
  process.stdout.write(`  root_loaded           : ${report.root_loaded}\n`);
  process.stdout.write(`  audit_nav_found       : ${report.audit_nav_found}\n`);
  process.stdout.write(`  memory_nav_found      : ${report.memory_nav_found}\n`);
  process.stdout.write(`  audit_surface_visible : ${report.audit_surface_visible}\n`);
  process.stdout.write(`  memory_surface_visible: ${report.memory_surface_visible}\n`);
  process.stdout.write(`  runtime_errors        : ${report.runtime_errors.length}\n`);
  for (const e of report.runtime_errors) process.stdout.write(`    - ${e}\n`);
  process.stdout.write(`  markers               : ${JSON.stringify(getSurfaceMarkers())}\n`);
}

function main(): void {
  process.stdout.write(`MWT-7C browser smoke — live runtime probe\n`);

  // 0. explicit skip
  if (isBrowserSmokeSkipped()) {
    const report = emptyReport("SKIPPED", { detail: "MWT7C_BROWSER_SMOKE=skip" });
    emit(report);
    process.exit(0);
  }

  // 1. environment availability probe
  const rt = detectBrowserRuntime();
  if (!rt.available) {
    const r = classifyBrowserSmoke({ mode: "BROWSER_UNAVAILABLE", reason: rt.reason });
    const report = emptyReport(r.status, { blocker: r.blocker, detail: r.detail });
    emit(report);
    // EXIT CODE: ENV_BLOCKED is not a failure of code; the aggregator treats
    // non-zero exit for `live` steps via its env-blocker classifier, but to keep
    // this script self-describing we exit 0 with status ENV_BLOCKED. The wrapper
    // (run-validation) parses the status text; here we surface honestly.
    process.exit(0);
  }

  // 2. browser binary IS available, BUT no real harness (Playwright/Puppeteer)
  //    exists in this repo to actually drive it. Per PM MWT-7C authorization we
  //    must NOT fake a PASS: without a runtime harness we cannot truly verify
  //    nav + surface visibility + console/hydration errors. Classify honestly as
  //    ENV_BLOCKED (runtime harness dependency missing), never PASS.
  //
  //    When a real harness is added, replace this branch with an actual launch:
  //      const page = await launch();               // headless chrome/edge
  //      await page.goto(ROOT_URL);                 // no backend needed
  //      if (!await page.$(SELECTORS.rootPage))     FAIL (assertion)
  //      await page.click(SELECTORS.auditNav);
  //      if (!await page.$(SELECTORS.auditSurface)) FAIL (audit surface)
  //      await page.click(SELECTORS.memoryNav);
  //      if (!await page.$(SELECTORS.memorySurface))FAIL (memory surface)
  //      const errs = await collectConsole/pageErrors();
  //      if (errs.length)                           FAIL (hydration/runtime)
  //      else                                        PASS
  const r = classifyBrowserSmoke({
    mode: "BROWSER_UNAVAILABLE",
    reason: `browser binary present (${rt.engine ?? "unknown"}) but no runtime harness (Playwright/Puppeteer) wired — cannot execute real nav/surface probe`,
  });
  const report = emptyReport(r.status, {
    browser_available: true,
    browser_engine: rt.engine,
    blocker: r.blocker,
    detail: r.detail,
  });
  emit(report);
  process.exit(0);
}

main();
