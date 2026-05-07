import pg from 'pg';
const { Client } = pg;

const CONN = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/smartrouter";

async function main() {
  const client = new Client(CONN);
  await client.connect();

  for (const table of ['delegation_logs', 'decision_logs']) {
    const r = await client.query(
      `SELECT column_name, data_type FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`,
      [table]
    );
    console.log(`\n=== ${table} ===`);
    for (const row of r.rows) {
      console.log(`  ${row.column_name} | ${row.data_type}`);
    }
  }

  await client.end();
}

main().catch(console.error);
