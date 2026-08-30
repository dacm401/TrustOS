/**
 * CLI for sovereign data backup / restore.
 *
 *   npm run backup:create -- --out backup.json
 *   npm run backup:create -- --out backup.enc --encrypt
 *   npm run backup:restore -- --in backup.json --dry-run
 *   npm run backup:restore -- --in backup.json
 *
 * Kept deliberately simple: no scheduling, no incremental, no cloud.
 * Those are future work; today the goal is that a user can snapshot their
 * sovereign data and get it back.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createSnapshot, restoreSnapshot, SNAPSHOT_SCHEMA, type Snapshot } from "../src/services/sovereign/backup.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function has(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const command = process.argv[2];
const userId = arg("user") ?? process.env.TRUSTOS_BACKUP_USER ?? "admin";

async function main(): Promise<void> {
  if (command === "create") {
    const out = arg("out");
    if (!out) {
      console.error("Usage: npm run backup:create -- --out <file> [--encrypt] [--user <id>]");
      process.exit(1);
    }
    const encrypt = has("encrypt");
    let passphrase: string | undefined;
    if (encrypt) {
      passphrase = arg("passphrase") ?? process.env.TRUSTOS_BACKUP_PASSPHRASE;
      if (!passphrase) {
        console.error("Encryption requested but no passphrase given.");
        console.error("Provide --passphrase <pw> or set TRUSTOS_BACKUP_PASSPHRASE.");
        console.error("⚠️  Losing the passphrase means the backup is UNRECOVERABLE (no back door).");
        process.exit(1);
      }
    }

    const snapshot = await createSnapshot(userId, { passphrase });
    writeFileSync(out, JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`✅ Snapshot written: ${out}`);
    console.log(`   schema          : ${snapshot.schema}`);
    console.log(`   user            : ${snapshot.user_id}`);
    console.log(`   conversation    : ${snapshot.counts.conversation_turns} turns`);
    console.log(`   memory entries  : ${snapshot.counts.memory_entries}`);
    console.log(`   encrypted       : ${snapshot.encrypted}`);
    console.log(`   checksum        : ${snapshot.checksum.slice(0, 16)}…`);
    return;
  }

  if (command === "restore") {
    const input = arg("in");
    if (!input) {
      console.error("Usage: npm run backup:restore -- --in <file> [--dry-run] [--passphrase <pw>]");
      process.exit(1);
    }
    const raw = readFileSync(input, "utf8");
    let snapshot: Snapshot;
    try {
      snapshot = JSON.parse(raw) as Snapshot;
    } catch {
      console.error(`Cannot parse ${input} as JSON.`);
      process.exit(1);
    }

    if (snapshot.schema !== SNAPSHOT_SCHEMA) {
      console.error(`Unsupported schema: ${snapshot.schema} (expected ${SNAPSHOT_SCHEMA})`);
      process.exit(1);
    }

    const passphrase = arg("passphrase") ?? process.env.TRUSTOS_BACKUP_PASSPHRASE;
    const dryRun = has("dry-run");

    try {
      const result = await restoreSnapshot(snapshot, { passphrase, dryRun });
      if (result.dryRun) {
        console.log("🔍 Dry run — nothing was written.");
      } else {
        console.log("✅ Restore complete.");
      }
      console.log(`   conversation turns : ${result.restored.conversation_turns}`);
      console.log(`   memory entries     : ${result.restored.memory_entries}`);
      if (result.skipped > 0) console.log(`   skipped (errors)   : ${result.skipped}`);
    } catch (err) {
      console.error(`❌ Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
    return;
  }

  console.error("Usage:");
  console.error("  npm run backup:create  -- --out <file> [--encrypt] [--passphrase <pw>]");
  console.error("  npm run backup:restore -- --in <file> [--dry-run] [--passphrase <pw>]");
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
