import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `free_grants` — the table behind "your first listing is free".
 *
 * ── Why this migration exists at all ───────────────────────────────────────
 *
 * The feature shipped in code without it. The entity was written, the claim
 * logic was written, and the table appeared on every developer's machine
 * because `synchronize` was on outside production. Production, correctly,
 * has it off — so the table was never created there.
 *
 * The symptom was not a missing free listing. It was worse: `claimFreeAction`
 * runs `INSERT INTO free_grants`, that throws `relation does not exist`, and
 * the whole listing-post transaction rolls back. Every listing post fails,
 * paid ones included, the moment the code is deployed.
 *
 * This is the exact failure the migration tooling was added to prevent, and
 * it is worth keeping the comment: a table that exists only because
 * `synchronize` made it is a table production does not have.
 *
 * ── The shape, and why the key is the mechanism ────────────────────────────
 *
 * A row means "this account has spent its free use of that action". There is
 * no "unused" row, so nothing is backfilled and nothing is written at
 * sign-up — an account that has never posted simply has nothing here.
 *
 * The composite primary key IS the concurrency control. Claiming is one
 * `INSERT ... ON CONFLICT DO NOTHING RETURNING user_id`: two listing posts
 * racing on the same account contend on the key, exactly one gets a row
 * back, and exactly one goes free. No lock, no read-then-write window.
 */
export class FreeGrants1762300000000 implements MigrationInterface {
  name = 'FreeGrants1762300000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS free_grants (
        user_id      uuid        NOT NULL,
        -- A TariffAction. varchar rather than an enum: actions are added by
        -- editing a constant, and an enum would need a migration for each.
        action       varchar(40) NOT NULL,
        -- What it was spent on — the listing id, for a LISTING_POST grant.
        -- Not required by the mechanism; it is here so an admin asking
        -- "what did they get for free" has an answer.
        reference_id uuid,
        used_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_free_grants" PRIMARY KEY (user_id, action)
      )`);

    // Matches @Index('IDX_free_grants_used_at') on the entity. Without the
    // same name, a later `synchronize` comparison — or anyone reading the
    // two side by side — sees a difference that is not there.
    await q.query(`
      CREATE INDEX IF NOT EXISTS "IDX_free_grants_used_at"
        ON free_grants (used_at)`);
  }

  /**
   * Dropping this gives every account its free listing back.
   *
   * That is the honest consequence and the reason to think before reverting:
   * the rows are not derived from anything, so there is nowhere to rebuild
   * them from. Reverting on a live database hands out a second free listing
   * to everyone who has already used theirs.
   */
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "IDX_free_grants_used_at"`);
    await q.query(`DROP TABLE IF EXISTS free_grants`);
  }
}
