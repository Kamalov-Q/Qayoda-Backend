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
      END $$;

      -- The enum types are unused once both columns are text.
      DROP TYPE IF EXISTS listings_category_enum;
      DROP TYPE IF EXISTS listing_map_points_category_enum;
    `);
  } finally {
    await client.end();
  }
}
