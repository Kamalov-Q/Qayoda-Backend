-- Listing reviews + the denormalized rating on listings.
--
-- `synchronize` is off in production (see shared/database/typeorm.config.ts),
-- so this is the hand-applied version of what it would have created. Safe to
-- re-run: every statement is IF NOT EXISTS.
--
--   psql "$DATABASE_URL" -f sql/2026-09-24-listing-reviews.sql
--
-- Afterwards `npm run schema:sql` should report nothing about these tables.

BEGIN;

-- What TypeORM's @PrimaryGeneratedColumn('uuid') defaults to; every other
-- table here already uses it, so it is present — asserted, not assumed.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS listing_reviews (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id  uuid        NOT NULL,
  author_id   uuid        NOT NULL,
  rating      smallint    NOT NULL,
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_review_listing_author UNIQUE (listing_id, author_id)
);

CREATE INDEX IF NOT EXISTS idx_listing_reviews_listing_id
  ON listing_reviews (listing_id);
CREATE INDEX IF NOT EXISTS idx_listing_reviews_author_id
  ON listing_reviews (author_id);

-- The aggregate every card reads, so stars cost no extra query.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rating_avg   real;
ALTER TABLE listings ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;

-- Backfill, in case reviews landed before this ran.
UPDATE listings l
   SET rating_avg = s.avg, rating_count = s.cnt
  FROM (SELECT listing_id, AVG(rating) AS avg, COUNT(*) AS cnt
          FROM listing_reviews GROUP BY listing_id) s
 WHERE l.id = s.listing_id;

COMMIT;
