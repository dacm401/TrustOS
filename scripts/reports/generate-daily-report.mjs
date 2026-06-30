#!/usr/bin/env node
/**
 * S99P: Daily Beta Report Generator
 *
 * Usage:
 *   node scripts/reports/generate-daily-report.mjs [--date YYYY-MM-DD] [--admin-key <key>] [--output <file>]
 *
 * Fetches daily summary, feedback stats, cost trends, and failure reasons
 * from the admin API, then generates a Markdown report.
 *
 * Defaults:
 *   --date: today
 *   --admin-key: admin-changeme (from TRUSTOS_ADMIN_KEY env or default)
 *   --output: prints to stdout
 */

const API_BASE = process.env.TRUSTOS_API_BASE || "http://localhost:3001";
const ADMIN_KEY = process.env.TRUSTOS_ADMIN_KEY || "admin-changeme";

async function main() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const idx = args.indexOf(name);
    return idx >= 0 ? args[idx + 1] : null;
  };

  const date = getArg("--date") || new Date().toISOString().slice(0, 10);
  const adminKey = getArg("--admin-key") || ADMIN_KEY;
  const outputFile = getArg("--output");

  const headers = { "X-Admin-Key": adminKey };

  console.error(`[daily-report] Fetching data for ${date}...`);

  // Fetch all endpoints
  const [summaryRes, costRes, satRes, failRes, feedbackRes] = await Promise.all([
    fetch(`${API_BASE}/v1/admin/daily-summary?date=${date}`, { headers }),
    fetch(`${API_BASE}/v1/admin/cost-trend?days=7`, { headers }),
    fetch(`${API_BASE}/v1/admin/satisfaction-trend?days=7`, { headers }),
    fetch(`${API_BASE}/v1/admin/failure-reasons?days=7`, { headers }),
    fetch(`${API_BASE}/v1/admin/feedback?limit=200&status=open`, { headers }),
  ]);

  if (!summaryRes.ok) throw new Error(`daily-summary: ${summaryRes.status} ${await summaryRes.text()}`);

  const summary = await summaryRes.json();
  const costTrend = costRes.ok ? await costRes.json() : null;
  const satTrend = satRes.ok ? await satRes.json() : null;
  const failReasons = failRes.ok ? await failRes.json() : null;
  const openFeedback = feedbackRes.ok ? await feedbackRes.json() : null;

  // Generate Markdown
  const lines = [];

  lines.push(`# TrustOS Beta Daily Report — ${date}`);
  lines.push("");
  lines.push(`> Generated: ${new Date().toISOString()}`);
  lines.push("");

  // ── Summary ──
  lines.push("## Daily Summary");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Active Users | ${summary.users.active} |`);
  lines.push(`| Sessions | ${summary.sessions.total} |`);
  lines.push(`| Tasks (completed/total) | ${summary.tasks.completed}/${summary.tasks.total} |`);
  lines.push(`| Failed Tasks | ${summary.tasks.failed} |`);
  lines.push(`| Cancelled Tasks | ${summary.tasks.cancelled} |`);
  lines.push(`| Timed Out | ${summary.tasks.timedOut} |`);
  lines.push(`| Total Cost | $${summary.cost.totalUsd.toFixed(4)} |`);
  lines.push("");

  // ── Feedback ──
  lines.push("## Feedback");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Total Feedback | ${summary.feedback.total} |`);
  lines.push(`| 👍 Thumbs Up | ${summary.feedback.thumbsUp} |`);
  lines.push(`| 👎 Thumbs Down | ${summary.feedback.thumbsDown} |`);
  lines.push(`| Satisfaction Rate | ${summary.feedback.satisfactionRatio}% |`);
  lines.push(`| Open Triage Items | ${summary.feedback.openTriage} |`);
  lines.push("");

  // ── Tokens ──
  lines.push("## Tokens");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Input Tokens | ${summary.cost.inputTokens.toLocaleString()} |`);
  lines.push(`| Output Tokens | ${summary.cost.outputTokens.toLocaleString()} |`);
  lines.push("");

  // ── 7-Day Cost Trend ──
  if (costTrend && costTrend.daily) {
    lines.push("## 7-Day Cost Trend");
    lines.push("");
    lines.push("| Day | Cost (USD) | Tasks |");
    lines.push("|---|---|---|");
    for (const d of costTrend.daily) {
      lines.push(`| ${d.day} | $${d.costUsd.toFixed(4)} | ${d.tasks} |`);
    }
    lines.push("");
  }

  // ── 7-Day Satisfaction Trend ──
  if (satTrend && satTrend.daily) {
    lines.push("## 7-Day Satisfaction Trend");
    lines.push("");
    lines.push("| Day | Total | 👍 | 👎 | Satisfaction |");
    lines.push("|---|---|---|---|---|");
    for (const d of satTrend.daily) {
      lines.push(`| ${d.day} | ${d.total} | ${d.thumbsUp} | ${d.thumbsDown} | ${d.satisfactionRatio}% |`);
    }
    lines.push("");
  }

  // ── Top Failure Reasons ──
  if (failReasons && failReasons.topKeywords?.length > 0) {
    lines.push("## Top Failure Keywords (7 days)");
    lines.push("");
    lines.push(`Total 👎 events: ${failReasons.totalThumbsDown}`);
    lines.push("");
    lines.push("| Keyword | Count |");
    lines.push("|---|---|");
    for (const kw of failReasons.topKeywords.slice(0, 15)) {
      lines.push(`| ${kw.keyword} | ${kw.count} |`);
    }
    lines.push("");

    if (failReasons.recentSamples?.length > 0) {
      lines.push("### Recent Sample Reasons");
      lines.push("");
      for (const s of failReasons.recentSamples.slice(0, 5)) {
        lines.push(`- **"${s.reason}"** — _${s.queryPreview?.slice(0, 100) || "(no query)"}_`);
      }
      lines.push("");
    }
  }

  // ── Open Triage Items ──
  if (openFeedback && openFeedback.items?.length > 0) {
    lines.push("## Open Triage Items");
    lines.push("");
    const high = openFeedback.items.filter((i) => i.triage?.severity === "high" || i.triage?.severity === "blocker");
    if (high.length > 0) {
      lines.push(`### 🔴 High/Blocker (${high.length})`);
      lines.push("");
      for (const fb of high.slice(0, 10)) {
        lines.push(`- [${fb.triage.severity}] ${fb.eventType} — ${fb.reason || fb.queryPreview?.slice(0, 100) || "(no detail)"} (${fb.userId?.slice(0, 12)}...)`);
      }
      lines.push("");
    }
    const rest = openFeedback.items.filter((i) => i.triage?.severity !== "high" && i.triage?.severity !== "blocker");
    if (rest.length > 0) {
      lines.push(`### Other Open (${rest.length})`);
      lines.push("");
      lines.push(`- ${rest.length} items with severity low/medium`);
      lines.push("");
    }
  }

  // ── Cost Per User (today) ──
  if (costTrend && costTrend.perUser) {
    lines.push("## Cost Per User (Today)");
    lines.push("");
    lines.push("| User | Cost (USD) | Requests |");
    lines.push("|---|---|---|");
    for (const u of costTrend.perUser.slice(0, 10)) {
      lines.push(`| ${u.userId?.slice(0, 12)}... | $${u.costUsd.toFixed(4)} | ${u.requests} |`);
    }
    lines.push("");
  }

  // ── Footer ──
  lines.push("---");
  lines.push("");
  lines.push(`*Report generated by S99P Daily Report Generator at ${new Date().toISOString()}*`);

  const markdown = lines.join("\n");

  if (outputFile) {
    const fs = await import("fs");
    fs.writeFileSync(outputFile, markdown, "utf8");
    console.error(`[daily-report] Written to ${outputFile}`);
  } else {
    console.log(markdown);
  }
}

main().catch((err) => {
  console.error(`[daily-report] ERROR: ${err.message}`);
  process.exit(1);
});
