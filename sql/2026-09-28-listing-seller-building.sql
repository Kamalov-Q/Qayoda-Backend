-- Two facts every buyer filters on before anything else: who is selling, and
-- whether the building is new.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run.
--
--   psql "$DATABASE_URL" -f sql/2026-09-28-listing-seller-building.sql

BEGIN;

-- TypeORM names an enum type after its table and column.
DO $$ BEGIN
  CREATE TYPE listings_seller_type_enum AS ENUM ('OWNER', 'REALTOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE listings_building_type_enum AS ENUM ('NEW', 'SECONDARY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Both nullable: every listing posted before today has no answer, and a
-- default would put a claim in the seller's mouth.
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS seller_type listings_seller_type_enum;
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS building_type listings_building_type_enum;

-- Indexed because these become filters, and a filter on an unindexed column
-- over a growing table is a sequential scan per search.
CREATE INDEX IF NOT EXISTS "IDX_638f787e51b7910040aa6ad52e"
  ON listings (seller_type);
CREATE INDEX IF NOT EXISTS "IDX_3af68feba99d588eb1d1595621"
  ON listings (building_type);

COMMIT;

-- State of repair. Six levels rather than the yes/no the REPAIRED amenity
-- gave, because "ta'mirlangan" covers everything from fresh paint to a
-- designer fit-out and buyers filter on the difference.
BEGIN;

DO $$ BEGIN
  CREATE TYPE listings_repair_type_enum AS ENUM (
    'NEEDS_REPAIR', 'AVERAGE', 'COSMETIC', 'EURO', 'DESIGNER', 'CAPITAL'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS repair_type listings_repair_type_enum;

CREATE INDEX IF NOT EXISTS "IDX_ed339ba12787dd3fc7efdf51b6"
  ON listings (repair_type);

COMMIT;
