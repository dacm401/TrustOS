/**
 * CLI for sovereign archive bundles (Phase 2).
 *
 *   npm run archive:status
 *   npm run archive:create  -- --out 2026-08.enc --passphrase <pw> [--before 2026-08-01]
 *   npm run archive:import  -- --in 2026-08.enc --passphrase <pw> [--dry-run]
 *
 * Archiving MOVES raw turns out of the hot layer but NEVER deletes them —
 * the sovereign record accumulates forever.
 */

import { readFileSync, writeFileSync } from "node:fs";
import {
  countArchiveable,
  createArchiveBundle,
  importArchiveBundle,
  ARCHIVE_SCHEMA,
  type ArchiveBundle,
} from "../src/services/sovereign/archive.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const command = process.argv[2];
const userId = arg("user") ?? process.env.TRUSTOS_BACKUP_USER ?? "admin";

function getPassphrase(required: boolean): string | undefined {
  const pw = arg("passphrase") ?? process.env.TRUSTOS_BACKUP_PASSPHRASE;
  if (!pw && required) {
    console.error("A passphrase is required (archive bundles are meant to leave the machine).");
    console.error("Provide --passphrase <pw> or set TRUSTOS_BACKUP_PASSPHRASE.");
    console.error("⚠️  Losing the passphrase means the bundle is UNRECOVERABLE (no back door).");
    process.exit(1);
  }
  return pw;
}

async function main(): Promise<void> {
  if (command === "status") {
    const before = arg("before") ? new Date(String(arg("before"))) : undefined;
    const n = await countArchiveable(userId, before);
    console.log(`Hot-layer turns awaiting archive: ${n}`);
    if (n === 0) console.log("Nothing to archive.");
    return;
  }

  if (command === "create") {
    const out = arg("out");
    if (!out) {
      console.error("Usage: npm run archive:create -- --out <file> --passphrase <pw> [--before <date>]");
      process.exit(1);
    }
    const passphrase = getPassphrase(true)!;
    const before = arg("before") ? new Date(String(arg("before"))) : undefined;

    const bundle = await createArchiveBundle(userId, { passphrase, before });
    writeFileSync(out, JSON.stringify(bundle, null, 2), "utf8");

    console.log(`📦 Archive written: ${out}`);
    console.log(`   archive_id  : ${bundle.archive_id}`);
    console.log(`   turns       : ${bundle.turn_count}`);
    console.log(`   range       : ${bundle.range.from ?? "—"} → ${bundle.range.to ?? "—"}`);
    console.log(`   checksum    : ${bundle.checksum.slice(0, 16)}…`);
    console.log("");
    console.log("   ℹ️  Turns were MARKED as archived, not deleted — the sovereign");
    console.log("       record persists. Distilled memory is never archived.");
    return;
  }

  if (command === "import") {
    const input = arg("in");
    if (!input) {
      console.error("Usage: npm run archive:import -- --in <file> --passphrase <pw> [--dry-run]");
      process.exit(1);
    }
    const passphrase = getPassphrase(true)!;
    let bundle: ArchiveBundle;
    try {
      bundle = JSON.parse(readFileSync(input, "utf8")) as ArchiveBundle;
    } catch {
      console.error(`Cannot parse ${input} as JSON.`);
      process.exit(1);
    }
    if (bundle.schema !== ARCHIVE_SCHEMA) {
      console.error(`Unsupported schema: ${bundle.schema} (expected ${ARCHIVE_SCHEMA})`);
      process.exit(1);
    }

    try {
      const res = await importArchiveBundle(bundle, { passphrase, dryRun: has("dry-run") });
      if (res.dryRun) {
        console.log("🔍 Dry run — nothing was written.");
      } else {
        console.log("✅ Import complete (turns returned to the hot layer).");
      }
      console.log(`   restored : ${res.restored}`);
      if (res.skipped > 0) console.log(`   skipped  : ${res.skipped}`);
    } catch (err) {
      console.error(`❌ Import failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  console.error("Usage:");
  console.error("  npm run archive:status");
  console.error("  npm run archive:create -- --out <file> --passphrase <pw> [--before <date>]");
  console.error("  npm run archive:import -- --in <file> --passphrase <pw> [--dry-run]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
