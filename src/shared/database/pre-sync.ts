/**
 * Schema changes `synchronize` must never be allowed to make itself.
 *
 * TypeORM's synchronize implements a column TYPE change as DROP COLUMN + ADD
 * COLUMN. For `listings.category` (enum → text, so admins can add categories)
 * that would erase the category of every listing. So the conversion is done
 * here first, in place, keeping every value — and by the time synchronize
 * compares the entity with the database, the two already agree and it has
 * nothing to do.
 *
 * Idempotent: each step checks the current state, so every boot after the
 * first is a couple of catalogue reads and no writes.
 */
// pg ships without bundled types and @types/pg isn't installed; the three
// calls used here are typed locally instead of pulling in a dependency.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { Client } = require('pg') as {
  Client: new (config: { connectionString: string; ssl?: unknown }) => {
    connect(): Promise<void>;
    query(sql: string): Promise<unknown>;
    end(): Promise<void>;
  };
};

export async function runPreSync(url: string, ssl: unknown): Promise<void> {
  const client = new Client({ connectionString: url, ssl });
  await client.connect();
  try {
    await client.query(`
      DO $$
      BEGIN
        -- Categories became data (the categories table); the listing keeps the
        -- same string it always stored ('APARTMENT', …) — only the column type
        -- changes, via USING so no value is lost.
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'listings' AND column_name = 'category'
            AND data_type = 'USER-DEFINED'
        ) THEN
          ALTER TABLE listings
            ALTER COLUMN category TYPE varchar(40) USING category::text;
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'listing_map_points' AND column_name = 'category'
            AND data_type = 'USER-DEFINED'
        ) THEN
          ALTER TABLE listing_map_points
            ALTER COLUMN category TYPE varchar(40) USING category::text;
        END IF;

        -- Billing columns that were widened after the first version shipped.
        -- Left to synchronize these would be DROP + ADD NOT NULL, which fails
        -- on a table with rows (and would erase them if it did not).
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tariffs' AND column_name = 'name_uz'
            AND character_maximum_length < 120
        ) THEN
          ALTER TABLE tariffs
            ALTER COLUMN name_uz TYPE varchar(120),
            ALTER COLUMN name_ru TYPE varchar(120);
        END IF;

        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'wallet_transactions' AND column_name = 'kind'
            AND character_maximum_length < 32
        ) THEN
          ALTER TABLE wallet_transactions ALTER COLUMN kind TYPE varchar(32);
        END IF;
      END $$;

      -- Tariffs: the fixed \`key\` primary key became an \`action\` column
      -- behind a uuid id, so an admin can create and delete rows. Left to
      -- synchronize this is DROP + ADD NOT NULL, which fails on existing rows.
      DO $$
      DECLARE pk text;
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'tariffs' AND column_name = 'key'
        ) THEN
          UPDATE tariffs SET duration_days = 7
           WHERE key = 'LISTING_PROMOTE' AND duration_days IS NULL;
          SELECT conname INTO pk FROM pg_constraint
           WHERE conrelid = 'tariffs'::regclass AND contype = 'p';
          IF pk IS NOT NULL THEN
            EXECUTE format('ALTER TABLE tariffs DROP CONSTRAINT %I', pk);
          END IF;
          ALTER TABLE tariffs RENAME COLUMN key TO action;
          ALTER TABLE tariffs ADD COLUMN id uuid NOT NULL DEFAULT uuid_generate_v4();
          ALTER TABLE tariffs ADD CONSTRAINT "PK_tariffs" PRIMARY KEY (id);
          ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
        END IF;
      END $$;

      -- The enum types are unused once both columns are text.
      DROP TYPE IF EXISTS listings_category_enum;
      DROP TYPE IF EXISTS listing_map_points_category_enum;
    `);
  } finally {
    await client.end();
  }
}
