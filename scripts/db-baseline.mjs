/**
 * Marks the baseline migration as applied, WITHOUT running it.
 *
 * This is the one operation the TypeORM CLI has no command for, because it
 * is the one thing a migration tool is built not to do: claim that a change
 * has been made when it has not. On a database that already carries the
 * schema, that claim is exactly right — see the Baseline migration.
 *
 *   DATABASE_URL=… node scripts/db-baseline.mjs          report only
 *   DATABASE_URL=… node scripts/db-baseline.mjs --write  insert the row
 *
 * Read-only unless asked. It prints what it would do, which database it is
 * connected to and how many rows the key tables hold, so the thing you check
 * before writing is on the screen rather than in another terminal.
 */
import { readFileSync, readdirSync } from 'node:fs';
import 'dotenv/config';
import pg from 'pg';

const WRITE = process.argv.includes('--write');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

/** Same rule as the app and the CLI DataSource. */
const isLocal = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)[:/]/.test(url);

/** The first migration on disk by timestamp is the baseline by definition. */
function baselineOnDisk() {
  const dir = 'src/migrations';
  const files = readdirSync(dir).filter((f) => /^\d+-.*\.ts$/.test(f)).sort();
  if (files.length === 0) throw new Error(`No migrations found in ${dir}`);
  const file = files[0];
  const timestamp = Number(file.split('-')[0]);
  // The class name is what TypeORM records, not the file name.
  const name = readFileSync(`${dir}/${file}`, 'utf8').match(/export class (\w+)/)?.[1];
  if (!name) throw new Error(`Could not read a class name out of ${file}`);
  return { file, timestamp, name };
}

const { file, timestamp, name } = baselineOnDisk();
const client = new pg.Client({
  connectionString: url,
  ssl: isLocal ? false : { rejectUnauthorized: true },
});

await client.connect();
try {
  // Which database is this, actually. The commonest way to get this wrong is
  // to run it against the wrong one.
  const { rows: [where] } = await client.query(
    `SELECT current_database() AS db,
            inet_server_addr()::text AS host,
            pg_size_pretty(pg_database_size(current_database())) AS size`,
  );
  console.log(`database : ${where.db} on ${where.host ?? 'local socket'} (${where.size})`);
  console.log(`baseline : ${file} → ${name} (${timestamp})`);

  // A rough shape check, so "is this the right database" is answerable here.
  for (const table of ['users', 'listings', 'wallets', 'wallet_transactions']) {
    const { rows } = await client.query(
      `SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${table}`],
    );
    if (!rows[0].present) {
      console.log(`  ${table.padEnd(20)} MISSING`);
      continue;
    }
    const { rows: [c] } = await client.query(`SELECT count(*)::int AS n FROM ${table}`);
    console.log(`  ${table.padEnd(20)} ${c.n} rows`);
  }

  // TypeORM creates this on its first run; before that it does not exist.
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id        SERIAL PRIMARY KEY,
      timestamp BIGINT NOT NULL,
      name      VARCHAR NOT NULL
    )`);

  const { rows: applied } = await client.query(
    `SELECT name FROM migrations ORDER BY timestamp`,
  );
  console.log(`applied  : ${applied.length === 0 ? '(none)' : applied.map((r) => r.name).join(', ')}`);

  if (applied.some((r) => r.name === name)) {
    console.log('\nAlready baselined. Nothing to do.');
    process.exit(0);
  }

  if (applied.length > 0) {
    console.error(
      '\nRefusing: this database already has migration history, so the ' +
        'baseline is not the first thing that happened to it. Work out why ' +
        'before inserting anything.',
    );
    process.exit(1);
  }

  if (!WRITE) {
    console.log(
      `\nWould insert: (${timestamp}, '${name}')\n` +
        'Nothing written. Re-run with --write once the database above is the ' +
        'one you meant.',
    );
    process.exit(0);
  }

  await client.query(`INSERT INTO migrations (timestamp, name) VALUES ($1, $2)`, [
    timestamp,
    name,
  ]);
  console.log(`\nBaselined. Every migration after ${name} will run normally.`);
} finally {
  await client.end();
}
