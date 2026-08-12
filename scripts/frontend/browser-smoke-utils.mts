// MWT-7C — Browser Smoke shared utils.
//
// This module is the SINGLE source of truth for:
//   1. the browser-smoke status classifier (honest ENV_BLOCKED, never fake PASS)
//   2. the surface selectors / markers used to locate Audit & Memory surfaces
//   3. the environment-probe that decides if a real browser runtime is even
//      available in this environment (before attempting a live launch).
//
// Design constraints (PM MWT-7C authorization):
//   - browser unavailable            => ENV_BLOCKED (NOT PASS, NOT FAIL)
//   - dev server port/env blocked    => ENV_BLOCKED
//   - real UI assertion failure      => FAIL
//   - hydration / runtime / console  => FAIL (never swallowed)
//   - explicit skip flag             => SKIPPED
//   - no backend / DB / LLM / network dependency
//
// No Playwright/Puppeteer is present in this repo, so the LIVE run uses a
// lightweight, dependency-free runtime probe. When a real browser harness is
// added later, the selectors and classifier here should be reused unchanged.

import { type ValidationStatus } from "../trst/validation-status.ts";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";

// ── Selectors / markers ─────────────────────────────────────────────────────
// These MUST match the data-testid attributes added to the frontend surfaces
// in MWT-7C (AuditReviewSurface, MemoryGovernanceSurface, Sidebar nav).
export const SELECTORS = {
  rootPage: "body",
  auditNav: '[data-testid="nav-audit"]',
  memoryNav: '[data-testid="nav-memory"]',
  auditSurface: '[data-testid="audit-review-surface"]',
  memorySurface: '[data-testid="memory-governance-surface"]',
} as const;

export interface SurfaceMarkers {
  auditSurface: string;
  memorySurface: string;
  auditNav: string;
  memoryNav: string;
}

export function getSurfaceMarkers(): SurfaceMarkers {
  return {
    auditSurface: SELECTORS.auditSurface,
    memorySurface: SELECTORS.memorySurface,
    auditNav: SELECTORS.auditNav,
    memoryNav: SELECTORS.memoryNav,
  };
}

// ── Status classifier ───────────────────────────────────────────────────────
// Pure function: maps a probe situation to an honest ValidationStatus.
// There is intentionally NO catch-all that could silently convert a missing
// browser or a real failure into PASS.

export type BrowserProbeMode =
  | "BROWSER_UNAVAILABLE"
  | "SERVER_UNAVAILABLE"
  | "AUDIT_NAV_MISSING"
  | "MEMORY_NAV_MISSING"
  | "AUDIT_SURFACE_MISSING"
  | "MEMORY_SURFACE_MISSING"
  | "HYDRATION_RUNTIME_ERROR"
  | "ASSERTION_FAILED"
  | "ALL_REACHABLE"
  | "SKIP_REQUESTED";

export interface ClassifyInput {
  mode: BrowserProbeMode;
  reason?: string;
  /** When true, the run was explicitly skipped via env flag. */
  skip?: boolean;
}

export interface ClassifyResult {
  status: ValidationStatus;
  blocker?: string;
  detail?: string;
}

export function classifyBrowserSmoke(input: ClassifyInput): ClassifyResult {
  // Explicit skip always wins and is reported as SKIPPED.
  if (input.skip || input.mode === "SKIP_REQUESTED") {
    return { status: "SKIPPED", detail: input.reason ?? "browser smoke explicitly skipped" };
  }

  switch (input.mode) {
    // Environment problems: honest ENV_BLOCKED, never PASS.
    case "BROWSER_UNAVAILABLE":
      return {
        status: "ENV_BLOCKED",
        blocker: input.reason ?? "no browser runtime available in this environment",
        detail: "browser binary / harness not available",
      };
    case "SERVER_UNAVAILABLE":
      return {
        status: "ENV_BLOCKED",
        blocker: input.reason ?? "frontend dev/preview server could not start (port/env)",
        detail: "dev server unavailable due to environment, not a code failure",
      };

    // Real UI / runtime failures: FAIL, never ENV_BLOCKED, never PASS.
    case "AUDIT_NAV_MISSING":
      return { status: "FAIL", detail: input.reason ?? "Audit nav element not found in DOM" };
    case "MEMORY_NAV_MISSING":
      return { status: "FAIL", detail: input.reason ?? "Memory nav element not found in DOM" };
    case "AUDIT_SURFACE_MISSING":
      return { status: "FAIL", detail: input.reason ?? "AuditReviewSurface not rendered after nav" };
    case "MEMORY_SURFACE_MISSING":
      return { status: "FAIL", detail: input.reason ?? "MemoryGovernanceSurface not rendered after nav" };
    case "HYDRATION_RUNTIME_ERROR":
      return { status: "FAIL", detail: input.reason ?? "hydration / runtime / console error captured" };
    case "ASSERTION_FAILED":
      return { status: "FAIL", detail: input.reason ?? "explicit UI assertion failed" };

    case "ALL_REACHABLE":
      return { status: "PASS", detail: "root loaded, Audit + Memory reachable, no runtime errors" };

    default:
      // Fail-closed: unknown mode is treated as FAIL, never silently PASS.
      return { status: "FAIL", detail: `unknown browser probe mode: ${(input as ClassifyInput).mode}` };
  }
}

// ── Environment availability probe (dependency-free) ────────────────────────
// Detects whether a real browser runtime could be launched. We look for the
// most common, license-free headless engines WITHOUT adding a dependency:
//   - PUPPETEER_EXECUTABLE_PATH / PLAYWRIGHT_BROWSERS_PATH env hints
//   - common chrome/chromium binaries on PATH
// If none found, the live run classifies as ENV_BLOCKED honestly.

function commandExists(name: string): boolean {
  try {
    // `where` on Windows, `command -v` on POSIX.
    const probe = process.platform === "win32" ? `where ${name}` : `command -v ${name}`;
    execSync(probe, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function detectBrowserRuntime(): { available: boolean; engine?: string; reason?: string } {
  // Honour an explicit skip/force-block flag.
  if (process.env.MWT7C_BROWSER_SMOKE === "skip") {
    return { available: false, reason: "MWT7C_BROWSER_SMOKE=skip" };
  }

  // Env hints from harnesses (if a browser were installed later).
  if (process.env.PUPPETEER_EXECUTABLE_PATH || process.env.PLAYWRIGHT_BROWSERS_PATH) {
    return { available: true, engine: "env-hint" };
  }

  const candidates = ["google-chrome", "chrome", "chromium", "chromium-browser"];
  if (process.platform === "win32") candidates.push("chrome.exe", "msedge.exe");
  for (const c of candidates) {
    try {
      if (commandExists(c)) return { available: true, engine: c };
    } catch {
      /* ignore */
    }
  }

  // Fallback: direct path probes for common installs (no exec needed).
  const winPaths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  if (process.platform === "win32") {
    for (const p of winPaths) {
      try {
        if (existsSync(p)) return { available: true, engine: p };
      } catch {
        /* ignore */
      }
    }
  }

  return { available: false, reason: "no chrome/chromium/edge binary found on PATH or common paths" };
}

// ── Skip flag helper ────────────────────────────────────────────────────────
export function isBrowserSmokeSkipped(): boolean {
  return process.env.MWT7C_BROWSER_SMOKE === "skip";
}

// ── Report shape ────────────────────────────────────────────────────────────
export interface BrowserSmokeReport {
  status: ValidationStatus;
  blocker?: string;
  detail?: string;
  browser_available: boolean;
  browser_engine?: string;
  root_loaded: boolean;
  audit_nav_found: boolean;
  memory_nav_found: boolean;
  audit_surface_visible: boolean;
  memory_surface_visible: boolean;
  runtime_errors: string[];
  skipped: boolean;
}

export function emptyReport(status: ValidationStatus, partial: Partial<BrowserSmokeReport> = {}): BrowserSmokeReport {
  return {
    status,
    browser_available: false,
    root_loaded: false,
    audit_nav_found: false,
    memory_nav_found: false,
    audit_surface_visible: false,
    memory_surface_visible: false,
    runtime_errors: [],
    skipped: status === "SKIPPED",
    ...partial,
  };
}
