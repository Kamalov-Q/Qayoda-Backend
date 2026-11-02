import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Organizations with a shared wallet.
 *
 * Written by hand, not generated. `migration:generate` compares two schemas
 * and cannot know that `wallet_transactions.wallet_id` has to be backfilled
 * from `user_id` before it can be NOT NULL, or that the wallets primary key
 * must move only after `id` is populated. It also writes a column type
 * change as DROP + ADD, which on a money table means losing the column.
 *
 * ── What this does and does not add ────────────────────────────────────────
 *
 * Organizations are created by an admin, their members are attached by an
 * admin, and their wallet is credited by admin adjustment. Nothing external
 * ever pays INTO an org wallet.
 *
 * That removes the part of this design that was genuinely dangerous. Paynet
 * pushes money to an account NUMBER, so an org that could receive a Paynet
 * payment would need its own number, which meant moving `account_no` off
 * `users` onto `wallets` and repointing the Paynet handler — with every
 * number already printed in people's apps riding on it. None of that is
 * here. `users.account_no` is untouched, and so is `payments`.
 *
 * ── The re-key ─────────────────────────────────────────────────────────────
 *
 * A wallet is currently a user: `wallets.user_id` IS the primary key. A
 * wallet that belongs to an organization cannot be. So the table gets a
 * surrogate `id`, and exactly one of two owner columns.
 *
 * `user_id` is KEPT, in step with `wallet_transactions.user_id`, so the code
 * can be moved over in its own deploy rather than in the same one as the
 * schema. A later migration drops both, once nothing reads them.
 *
 * `currency` is added now, defaulted to UZS and used by nothing, because the
 * expansion plan puts a wallet per currency behind the same (owner,
 * currency) shape. Adding it here costs a column; adding it later costs
 * another re-key of the same table.
 */
export class Organizations1762200000000 implements MigrationInterface {
  name = 'Organizations1762200000000';

  public async up(q: QueryRunner): Promise<void> {
    // ── organizations ────────────────────────────────────────────────────
    await q.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name             varchar(120) NOT NULL,
        avatar_url       text,
        avatar_thumb_url text,
        -- Mirrors the user ban vocabulary rather than inventing a second
        -- one, so moderation reads the same on both.
        status           varchar(16) NOT NULL DEFAULT 'ACTIVE',
        created_by       uuid NOT NULL REFERENCES users(id),
        suspended_at     timestamptz,
        suspended_by     uuid REFERENCES users(id),
        suspend_reason   text,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now(),
        deleted_at       timestamptz,
        CONSTRAINT organizations_status_check
          CHECK (status IN ('ACTIVE', 'SUSPENDED'))
      )`);

    // ── organization_members ─────────────────────────────────────────────
    //
    // Rows are never deleted. A removed member's transactions still have to
    // say who spent the money and in what role, and a deleted row would
    // leave an actor_user_id pointing at nothing explainable.
    await q.query(`
      CREATE TABLE IF NOT EXISTS organization_members (
        organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role            varchar(16) NOT NULL DEFAULT 'MEMBER',
        status          varchar(16) NOT NULL DEFAULT 'ACTIVE',
        -- NULL means no limit. numeric, not integer: the rest of the money
        -- in this database is numeric(14,2) and a limit compared against a
        -- numeric sum should not be the one integer in the comparison.
        monthly_limit   numeric(14,2),
        can_spend       boolean NOT NULL DEFAULT true,
        -- Who attached them. An admin id here, since there are no invites.
        added_by        uuid REFERENCES users(id),
        joined_at       timestamptz NOT NULL DEFAULT now(),
        removed_at      timestamptz,
        PRIMARY KEY (organization_id, user_id),
        CONSTRAINT organization_members_role_check
          CHECK (role IN ('OWNER', 'ADMIN', 'MEMBER')),
        CONSTRAINT organization_members_status_check
          CHECK (status IN ('ACTIVE', 'REMOVED', 'LEFT'))
      )`);

    // Exactly one active owner per organization, enforced by the database.
    // Application code cannot guarantee this under a concurrent
    // transfer-ownership; a partial unique index can.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS organization_members_one_owner
        ON organization_members (organization_id)
        WHERE role = 'OWNER' AND status = 'ACTIVE'`);

    // "My organizations" — read on every wallet lookup, so it is an index
    // rather than a scan of a table that will be mostly REMOVED rows.
    await q.query(`
      CREATE INDEX IF NOT EXISTS organization_members_active_user
        ON organization_members (user_id)
        WHERE status = 'ACTIVE'`);

    // ── wallets: the re-key ──────────────────────────────────────────────
    await q.query(`
      ALTER TABLE wallets
        ADD COLUMN IF NOT EXISTS id              uuid NOT NULL DEFAULT gen_random_uuid(),
        ADD COLUMN IF NOT EXISTS owner_user_id   uuid,
        ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id),
        ADD COLUMN IF NOT EXISTS currency        char(3) NOT NULL DEFAULT 'UZS'`);

    // Every existing wallet belongs to the user it was keyed by.
    await q.query(`UPDATE wallets SET owner_user_id = user_id WHERE owner_user_id IS NULL`);

    // Move the primary key. Looked up by catalogue rather than by name:
    // TypeORM generated it as PK_92558c08091598f7a4439586cda, and hardcoding
    // that would break this migration on any database where synchronize
    // happened to name it something else.
    await q.query(`
      DO $$
      DECLARE pk text;
      BEGIN
        SELECT conname INTO pk FROM pg_constraint
          WHERE conrelid = 'wallets'::regclass AND contype = 'p';
        IF pk IS NOT NULL THEN
          EXECUTE format('ALTER TABLE wallets DROP CONSTRAINT %I', pk);
        END IF;
      END $$`);

    await q.query(`ALTER TABLE wallets ADD CONSTRAINT wallets_pkey PRIMARY KEY (id)`);

    // An org wallet has no user, so the column that used to be the primary
    // key cannot stay NOT NULL.
    await q.query(`ALTER TABLE wallets ALTER COLUMN user_id DROP NOT NULL`);

    // UNIQUE, and deliberately NOT a partial index.
    //
    // Postgres treats NULLs as distinct in a unique index, so a plain
    // UNIQUE(user_id) already allows every org wallet to have NULL there.
    // A partial index would have been tidier to read and would have broken
    // `ensureWallet`: its `ON CONFLICT (user_id)` can only infer a partial
    // index if the statement repeats the predicate, and that statement
    // belongs to code that is already deployed.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wallets_user_id_key ON wallets (user_id)`);

    /**
     * Keep user_id and owner_user_id in step, for the length of the
     * transition.
     *
     * The deploy order for a migration is: run it, THEN restart the API. In
     * between, the code that is running is the old code — and the old
     * `ensureWallet` inserts a wallet with only `user_id` set, which the XOR
     * check below would reject. Every listing posted in that window would
     * fail.
     *
     * The alternative is the three-deploy dance: additive migration, then a
     * release that writes both columns, then a migration that constrains.
     * This trigger buys the same safety in one deploy, and it is honest
     * about being temporary — the migration that finally drops `user_id`
     * drops this with it.
     */
    await q.query(`
      CREATE OR REPLACE FUNCTION wallets_sync_owner() RETURNS trigger AS $fn$
      BEGIN
        IF NEW.owner_user_id IS NULL AND NEW.organization_id IS NULL THEN
          NEW.owner_user_id := NEW.user_id;
        END IF;
        IF NEW.user_id IS NULL AND NEW.owner_user_id IS NOT NULL THEN
          NEW.user_id := NEW.owner_user_id;
        END IF;
        RETURN NEW;
      END $fn$ LANGUAGE plpgsql`);
    await q.query(`
      CREATE OR REPLACE TRIGGER wallets_sync_owner_trg
        BEFORE INSERT OR UPDATE ON wallets
        FOR EACH ROW EXECUTE FUNCTION wallets_sync_owner()`);

    // A wallet belongs to a person or to an organization. Never both, never
    // neither — "neither" is a wallet nobody can reach and nobody can audit.
    await q.query(`
      ALTER TABLE wallets ADD CONSTRAINT wallets_one_owner_check
        CHECK ((owner_user_id IS NULL) <> (organization_id IS NULL))`);

    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wallets_owner_currency_key
        ON wallets (owner_user_id, currency) WHERE owner_user_id IS NOT NULL`);
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wallets_org_currency_key
        ON wallets (organization_id, currency) WHERE organization_id IS NOT NULL`);

    // ── wallet_transactions: whose money, and who moved it ───────────────
    await q.query(`
      ALTER TABLE wallet_transactions
        ADD COLUMN IF NOT EXISTS wallet_id      uuid,
        ADD COLUMN IF NOT EXISTS actor_user_id  uuid REFERENCES users(id)`);

    // Backfill before NOT NULL. Both columns come from the same place today:
    // the row's user_id is both whose wallet it was and who acted.
    await q.query(`
      UPDATE wallet_transactions t
         SET wallet_id = w.id,
             actor_user_id = COALESCE(t.actor_user_id, t.user_id)
        FROM wallets w
       WHERE w.user_id = t.user_id
         AND t.wallet_id IS NULL`);

    // A transaction with no wallet is money that moved out of nowhere. If
    // the backfill left any, this fails the migration rather than leaving
    // the hole open — see the check in `down` for how to find them.
    const orphans = (await q.query(
      `SELECT count(*)::int AS n FROM wallet_transactions WHERE wallet_id IS NULL`,
    )) as { n: number }[];
    if (orphans[0].n > 0) {
      throw new Error(
        `${orphans[0].n} wallet_transactions rows have no matching wallet. ` +
          'Find them with: SELECT DISTINCT user_id FROM wallet_transactions t ' +
          'WHERE NOT EXISTS (SELECT 1 FROM wallets w WHERE w.user_id = t.user_id); ' +
          'every one is a transaction against a wallet that does not exist, ' +
          'which predates this migration and must be explained before it runs.',
      );
    }

    await q.query(`ALTER TABLE wallet_transactions ALTER COLUMN wallet_id SET NOT NULL`);
    await q.query(`
      ALTER TABLE wallet_transactions
        ADD CONSTRAINT wallet_transactions_wallet_fk
        FOREIGN KEY (wallet_id) REFERENCES wallets(id)`);

    // History, per wallet.
    await q.query(`
      CREATE INDEX IF NOT EXISTS wallet_transactions_wallet_created
        ON wallet_transactions (wallet_id, created_at DESC)`);
    // The monthly spend sum behind a member's limit. Without this it is a
    // scan of the org's whole history on every charge.
    await q.query(`
      CREATE INDEX IF NOT EXISTS wallet_transactions_wallet_actor_created
        ON wallet_transactions (wallet_id, actor_user_id, created_at)`);
    // Idempotency moves with the money: the same client_id against a
    // different wallet is a different payment.
    await q.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS wallet_transactions_wallet_client
        ON wallet_transactions (wallet_id, client_id) WHERE client_id IS NOT NULL`);

    // ── listings ─────────────────────────────────────────────────────────
    //
    // The MEMBER stays the owner (listings.owner_id). This only records
    // which organization paid, which is what makes the org's listings page
    // and the default payer for later promotions possible. Chat, reviews,
    // ratings and the phone number all keep working untouched, which is the
    // whole reason for choosing it this way round.
    await q.query(`
      ALTER TABLE listings
        ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES organizations(id)`);
    await q.query(`
      CREATE INDEX IF NOT EXISTS listings_organization_status
        ON listings (organization_id, status) WHERE organization_id IS NOT NULL`);

    // ── videos ───────────────────────────────────────────────────────────
    //
    // VIDEO_POST is charged when Bunny finishes encoding, with nobody in
    // front of the screen. The payer has to be decided at upload time and
    // remembered, or the charge has no wallet to go to.
    await q.query(`
      ALTER TABLE videos
        ADD COLUMN IF NOT EXISTS payer_wallet_id uuid REFERENCES wallets(id)`);
  }

  /**
   * Reverses the structure, and deliberately not the data.
   *
   * `wallet_id` and `actor_user_id` are dropped, which is safe only because
   * `user_id` is still populated on every row — that is the reason this
   * migration keeps it. If a later migration has already dropped `user_id`,
   * this `down` would destroy the only record of whose money moved, and
   * reverting is no longer the right tool: restore from a backup.
   */
  public async down(q: QueryRunner): Promise<void> {
    const hasUserId = (await q.query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'wallet_transactions' AND column_name = 'user_id'`,
    )) as { n: number }[];
    if (hasUserId[0].n === 0) {
      throw new Error(
        'Refusing to revert: wallet_transactions.user_id has already been ' +
          'dropped, so wallet_id is the only record of whose money moved. ' +
          'Restore from a backup instead.',
      );
    }

    await q.query(`ALTER TABLE videos DROP COLUMN IF EXISTS payer_wallet_id`);
    await q.query(`DROP INDEX IF EXISTS listings_organization_status`);
    await q.query(`ALTER TABLE listings DROP COLUMN IF EXISTS organization_id`);

    await q.query(`DROP INDEX IF EXISTS wallet_transactions_wallet_client`);
    await q.query(`DROP INDEX IF EXISTS wallet_transactions_wallet_actor_created`);
    await q.query(`DROP INDEX IF EXISTS wallet_transactions_wallet_created`);
    await q.query(`
      ALTER TABLE wallet_transactions
        DROP CONSTRAINT IF EXISTS wallet_transactions_wallet_fk`);
    await q.query(`
      ALTER TABLE wallet_transactions
        DROP COLUMN IF EXISTS actor_user_id,
        DROP COLUMN IF EXISTS wallet_id`);

    await q.query(`DROP INDEX IF EXISTS wallets_org_currency_key`);
    await q.query(`DROP INDEX IF EXISTS wallets_owner_currency_key`);
    await q.query(`DROP TRIGGER IF EXISTS wallets_sync_owner_trg ON wallets`);
    await q.query(`DROP FUNCTION IF EXISTS wallets_sync_owner()`);
    await q.query(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_one_owner_check`);
    await q.query(`ALTER TABLE wallets DROP CONSTRAINT IF EXISTS wallets_pkey`);
    await q.query(`DROP INDEX IF EXISTS wallets_user_id_key`);
    // Rows with no user_id are org wallets, which cannot exist once the
    // organizations table is gone — and the PK below would reject them.
    await q.query(`DELETE FROM wallets WHERE user_id IS NULL`);
    await q.query(`ALTER TABLE wallets ALTER COLUMN user_id SET NOT NULL`);
    await q.query(`ALTER TABLE wallets ADD PRIMARY KEY (user_id)`);
    await q.query(`
      ALTER TABLE wallets
        DROP COLUMN IF EXISTS currency,
        DROP COLUMN IF EXISTS organization_id,
        DROP COLUMN IF EXISTS owner_user_id,
        DROP COLUMN IF EXISTS id`);

    await q.query(`DROP TABLE IF EXISTS organization_members`);
    await q.query(`DROP TABLE IF EXISTS organizations`);
  }
}
