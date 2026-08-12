// MWT-7D — Browser Harness (Playwright + installed Chrome channel).
//
// Why Playwright (PM MWT-7D authorization permits a lightweight automation dep):
//   The repo had no browser automation tool. A hand-rolled Chrome CDP driver
//   proved fragile across Chrome versions. Playwright is the standard,
//   maintained harness. We use `channel: "chrome"` so it drives the ALREADY
//   INSTALLED Chrome — NO browser binary download, NO cache commit, minimal
//   dependency footprint (added as devDependency only).
//
// This module is the single source of truth for the HARNESS DRIVER:
//   - launchHarness(): start a browser via Playwright (chrome channel)
//   - driveAuditMemoryPath(): real click + surface assertions + error capture
//   - teardownHarness(): close browser
//
// All STATUS CLASSIFICATION lives in browser-smoke-utils.mts (MWT-7C) — this
// harness only produces raw signals; the caller classifies them honestly.

import { type Browser, type Page, type ConsoleMessage } from "playwright";

export interface HarnessHandle {
  browser: Browser;
  page: Page;
  consoleErrors: string[];
  pageErrors: string[];
}

/** Launch Chrome via Playwright using the locally-installed Chrome channel. */
export async function launchHarness(): Promise<HarnessHandle> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const page = await browser.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  // Only count GENUINE runtime/hydration JS errors. Network resource failures
  // (favicon 404, backend socket ERR_CONNECTION_REFUSED) are environment-level
  // noise unrelated to the Audit/Memory UI path and must NOT fail the smoke.
  const isResourceNoise = (text: string): boolean =>
    /Failed to load resource|ERR_CONNECTION_REFUSED|ERR_CONNECTION|net::|404 \(Not Found\)|favicon/i.test(text);
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error" && !isResourceNoise(msg.text())) consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err: Error) => {
    if (!isResourceNoise(err.message)) pageErrors.push(err.message);
  });
  return { browser, page, consoleErrors, pageErrors };
}

export async function teardownHarness(handle: HarnessHandle): Promise<void> {
  try {
    await handle.browser.close();
  } catch {
    /* ignore */
  }
}

/**
 * Real browser path: navigate to root, click Audit nav, assert surface,
 * click Memory nav, assert surface. Returns the observed booleans.
 */
export interface AuditMemoryProbe {
  rootLoaded: boolean;
  auditNavFound: boolean;
  memoryNavFound: boolean;
  auditSurfaceVisible: boolean;
  memorySurfaceVisible: boolean;
}

export async function driveAuditMemoryPath(
  handle: HarnessHandle,
  selectors: { auditNav: string; memoryNav: string; auditSurface: string; memorySurface: string },
  rootUrl: string,
): Promise<AuditMemoryProbe> {
  const { page } = handle;
  await page.goto(rootUrl, { waitUntil: "networkidle", timeout: 30000 });
  const rootLoaded = (await page.locator("body").count()) > 0;

  const auditNavFound = (await page.locator(selectors.auditNav).count()) > 0;
  const memoryNavFound = (await page.locator(selectors.memoryNav).count()) > 0;

  let auditSurfaceVisible = false;
  let memorySurfaceVisible = false;

  if (auditNavFound) {
    await page.locator(selectors.auditNav).click();
    await page.waitForTimeout(700);
    auditSurfaceVisible = (await page.locator(selectors.auditSurface).count()) > 0;
  }

  if (memoryNavFound) {
    await page.locator(selectors.memoryNav).click();
    await page.waitForTimeout(700);
    memorySurfaceVisible = (await page.locator(selectors.memorySurface).count()) > 0;
  }

  return {
    rootLoaded,
    auditNavFound,
    memoryNavFound,
    auditSurfaceVisible,
    memorySurfaceVisible,
  };
}

/** Honest availability check: Playwright importable + Chrome channel reachable. */
export async function harnessAvailable(): Promise<{ available: boolean; reason?: string }> {
  try {
    const { chromium } = await import("playwright");
    const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--no-sandbox"] });
    await browser.close();
    return { available: true };
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if (/Executable doesn't exist|channel.*not found|chromium.*not found|Failed to launch/i.test(msg)) {
      return { available: false, reason: `Playwright/Chrome channel unavailable: ${msg.slice(0, 120)}` };
    }
    return { available: false, reason: `harness launch failed: ${msg.slice(0, 120)}` };
  }
}
