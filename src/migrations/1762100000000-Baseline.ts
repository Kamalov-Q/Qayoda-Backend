import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The starting line. It creates nothing and drops nothing.
 *
 * ── What a baseline is for ─────────────────────────────────────────────────
 *
 * Migrations assume they built the database. This one did not: production
 * was built by `synchronize` and by the hand-run files in `sql/`, over
 * months, before any of this existed. There is no sequence of migrations
 * that would reproduce it, and writing one after the fact would be fiction.
 *
 * So the history starts here, by agreement. `up()` asserts that the schema
 * it expects is already present and otherwise does nothing. The row in the
 * `migrations` table is the real content of this file: it says "everything
 * before this point already happened", and every migration after it is a
 * genuine, reviewed change.
 *
 * ── Applying it to a database that already exists ──────────────────────────
 *
 * On production the row is inserted WITHOUT running anything:
 *
 *   INSERT INTO migrations (timestamp, name)
 *   VALUES (1762100000000, 'Baseline1762100000000');
 *
 * `npm run db:baseline` does exactly that, and refuses if the table is not
 * there or the row already is.
 *
 * On an EMPTY database — a new developer, a test run, a restored dump used
 * as a scratch copy — running this migration cannot produce the schema. Use
 * the schema dump instead:
 *
 *   pg_dump "$PROD_URL" --schema-only --no-owner -f baseline.sql
 *   psql "$NEW_URL" -f baseline.sql
 *   npm run db:baseline
 *
 * That is the honest answer. A baseline marks a line in the sand; it is not
 * a way to build the thing behind the line.
 *
 * ── Why up() checks rather than simply returning ───────────────────────────
 *
 * Marking a schema as "already migrated" when it is not is the one mistake
 * that cannot be undone by reverting: every later migration then runs
 * against a shape nobody verified. The check costs one catalogue read and
 * fails loudly instead.
 */
export class Baseline1762100000000 implements MigrationInterface {
  name = 'Baseline1762100000000';

  /**
   * Tables that must exist for this to be the database this baseline
   * describes. Deliberately a small, load-bearing set rather than all of
   * them — a longer list would have to be maintained, and a baseline that
   * fails because an unrelated table was renamed is a baseline people
   * delete.
   */
  private static readonly EXPECTED = [
    'users',
    'listings',
    'wallets',
    'wallet_transactions',
    'payments',
  ];

  public async up(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [Baseline1762100000000.EXPECTED],
    );

    const found = new Set((rows as { table_name: string }[]).map((r) => r.table_name));
    const missing = Baseline1762100000000.EXPECTED.filter((t) => !found.has(t));

    if (missing.length > 0) {
      throw new Error(
        `Baseline: this database is missing ${missing.join(', ')}.\n` +
          'A baseline marks an EXISTING schema as already migrated; it does ' +
          'not create one. For an empty database, load a schema dump first:\n' +
          '  pg_dump "$PROD_URL" --schema-only --no-owner -f baseline.sql\n' +
          '  psql "$NEW_URL" -f baseline.sql\n' +
          '  npm run db:baseline',
      );
    }
  }

  /**
   * Reverting the starting line would claim the schema before it never
   * existed, and the next `db:run` would try to apply every migration from
   * the beginning onto a database that already has them.
   */
  public down(): Promise<void> {
    return Promise.reject(
      new Error(
        'Baseline cannot be reverted. It records that the schema already ' +
          'existed; there is nothing before it to go back to.',
      ),
    );
  }
}
