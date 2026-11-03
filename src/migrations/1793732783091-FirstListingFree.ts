import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The first listing post is on the house.
 *
 * One row per (account, action) means "this account has used its free go".
 * The row IS the grant's record: there is no wallet_transaction for a free
 * post, because `amount` is assertPositive and a 0 so'm ledger line explains
 * nothing it does not also confuse.
 *
 * ── Why a table and not `count(listings) = 0` ──────────────────────────────
 *
 *  * listings are HARD deleted (listing.entity.ts has no DeleteDateColumn),
 *    so a count would regrant the freebie on every post → delete → post.
 *  * a count is read-then-write. Two simultaneous posts both read 0 and both
 *    go free. The INSERT ... ON CONFLICT DO NOTHING RETURNING in
 *    WalletService.chargeTariff cannot: the composite primary key below makes
 *    them race on one row and exactly one gets a row back.
 *
 * Keyed by action rather than a `users.free_listing_used_at` column so the
 * same mechanism covers VIDEO_POST the day somebody wants it — see
 * FIRST_FREE_ACTIONS in billing.constants.ts.
 *
 * ── No backfill, deliberately ──────────────────────────────────────────────
 *
 * Every account gets one free post when this ships, including accounts that
 * have been posting (and paying) for months. Seeding a used row per existing
 * owner was the alternative and was rejected: the grant is a welcome, not an
 * accounting correction.
 *
 * ── No foreign key ─────────────────────────────────────────────────────────
 *
 * Matching every other table in this module — wallets, wallet_transactions
 * and payments all hold a bare uuid. `synchronize` is still on outside
 * production and drops constraints the entities do not declare, and these
 * entities declare no relations. Users are soft-deleted anyway, so there is
 * nothing to cascade from.
 *
 * ── Idempotent ─────────────────────────────────────────────────────────────
 *
 * IF NOT EXISTS throughout, because `synchronize` has very likely already
 * created this table locally from the entity by the time anyone runs this.
 * Names match src/modules/billing/entities/free-grant.entity.ts so
 * `npm run schema:sql` stays silent either way.
 */
export class FirstListingFree1793732783091 implements MigrationInterface {
  name = 'FirstListingFree1793732783091';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS free_grants (
        user_id      uuid        NOT NULL,
        action       varchar(40) NOT NULL,
        reference_id uuid,
        used_at      timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_free_grants" PRIMARY KEY (user_id, action)
      )
    `);

    // The admin list is "who used it, newest first".
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_free_grants_used_at" ON free_grants (used_at)
    `);
  }

  /**
   * Reverting gives EVERY account its free post back, because the rows that
   * recorded the used ones are the only place that fact lives. That is the
   * correct behaviour for undoing the feature — but it is money, so it is
   * stated here rather than left to be discovered.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS free_grants`);
  }
}
