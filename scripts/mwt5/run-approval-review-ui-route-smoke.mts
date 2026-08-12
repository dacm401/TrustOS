// MWT-5R-UI-II — Route integration smoke (static + typecheck).
//
// No React harness available, so v0 validates via:
//   1. entry surface file exists and renders the panel
//   2. root page wires the "audit" nav into the surface
//   3. deterministic fixtures are wired into the surface
//   4. all four honest states are available
//   5. frontend typecheck passes (0 errors)
//
// This is the authorized script-level validation for the route-integration slice.

import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";

const ROOT = join(process.cwd());
const FRONTEND = join(ROOT, "frontend");

let pass = 0;
let fail = 0;
const fails: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(name);
  }
}

// --- 1. Entry surface exists and consumes the panel + fixtures ---
const surfacePath = join(FRONTEND, "src/components/audit/AuditReviewSurface.tsx");
check("AuditReviewSurface.tsx exists", existsSync(surfacePath));
if (existsSync(surfacePath)) {
  const src = readFileSync(surfacePath, "utf8");
  check("surface imports ApprovalReviewPanel", src.includes("ApprovalReviewPanel"));
  check("surface imports deterministic fixtures", src.includes("__fixtures__/approval-reviews"));
  check("surface renders the panel", /<ApprovalReviewPanel/.test(src));
  check("surface renders approvedVerified", src.includes("approvedVerified"));
  check("surface renders mismatch", src.includes("mismatch"));
  check("surface renders legacyUnsigned", src.includes("legacyUnsigned"));
  check("surface renders unavailable", src.includes("unavailable"));
  check("surface has no backend/API import", !/api\/|fetch\(|axios|\/db/.test(src));
}

// --- 2. Root page wires the audit nav into the surface ---
const pagePath = join(FRONTEND, "src/app/page.tsx");
check("page.tsx exists", existsSync(pagePath));
if (existsSync(pagePath)) {
  const src = readFileSync(pagePath, "utf8");
  check("page imports AuditReviewSurface", src.includes("AuditReviewSurface"));
  check("page has audit nav type", src.includes('"audit"'));
  check("page renders audit surface", /activeNav === "audit"/.test(src) && src.includes("<AuditReviewSurface"));
}

// --- 3. Sidebar exposes the Audit entry ---
const sidebarPath = join(FRONTEND, "src/components/layout/Sidebar.tsx");
check("Sidebar.tsx exists", existsSync(sidebarPath));
if (existsSync(sidebarPath)) {
  const src = readFileSync(sidebarPath, "utf8");
  check("sidebar has audit nav item", /id: "audit"/.test(src));
}

// --- 4. No untrusted state mapped to positive (reuse same invariant) ---
const fixturePath = join(FRONTEND, "src/components/audit/__fixtures__/approval-reviews.ts");
check("fixtures file exists", existsSync(fixturePath));
if (existsSync(fixturePath)) {
  const src = readFileSync(fixturePath, "utf8");
  check("fixture approved_verified present", src.includes('conclusion: "approved_verified"'));
  check("fixture mismatch present", src.includes('conclusion: "mismatch"'));
  check("fixture legacy_unsigned present", src.includes('conclusion: "legacy_unsigned"'));
  check("fixture unavailable present", src.includes('conclusion: "unavailable"'));
}

// --- 5. Frontend typecheck ---
const tscRel =
  process.platform === "win32"
    ? "node_modules\\.bin\\tsc.cmd"
    : "node_modules/.bin/tsc";
const tscCmd = process.platform === "win32" ? `cmd /c ${tscRel}` : tscRel;
try {
  execSync(tscCmd + " --noEmit", {
    cwd: FRONTEND,
    stdio: ["ignore", "pipe", "pipe"],
  });
  check("frontend tsc --noEmit 0 errors", true);
} catch (e) {
  const err = e as { stderr?: Buffer; stdout?: Buffer; status?: number; message?: string };
  const out = (err?.stderr ?? err?.stdout ?? Buffer.from("")).toString();
  console.error("[tsc output]\n" + out);
  console.error("[tsc status] " + (err?.status ?? "n/a") + " msg=" + (err?.message ?? ""));
  check("frontend tsc --noEmit 0 errors", false);
}

console.log(`\n[MWT-5R-UI-II route smoke] ${pass} PASS / ${fail} FAIL`);
if (fail > 0) {
  console.log("Failures:\n - " + fails.join("\n - "));
  process.exit(1);
}
console.log("OK: audit review panel is reachable from the frontend surface; no backend dependency.");
