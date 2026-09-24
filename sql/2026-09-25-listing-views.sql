-- Distinct-viewer counts on listings.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run: every statement is IF NOT
-- EXISTS. Index names are TypeORM's own (sha1(table_column) truncated to 26),
-- so `npm run schema:sql` stays quiet.
--
--   psql "$DATABASE_URL" -f sql/2026-09-25-listing-views.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS listing_views (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id uuid        NOT NULL,
  -- `u:<userId>` for a signed-in viewer, `d:<deviceId>` for a guest.
  viewer_key varchar(80) NOT NULL,
  user_id    uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_view_listing_viewer UNIQUE (listing_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS "IDX_8dd1398aa912e11f24f18dc3bc"
  ON listing_views (listing_id);
CREATE INDEX IF NOT EXISTS "IDX_f6fbcff8ed71e1ade075e70447"
  ON listing_views (user_id);

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS view_count integer NOT NULL DEFAULT 0;

-- Backfill, in case views landed before this ran.
UPDATE listings l
   SET view_count = s.cnt
  FROM (SELECT listing_id, COUNT(*) AS cnt
          FROM listing_views GROUP BY listing_id) s
 WHERE l.id = s.listing_id;

COMMIT;
