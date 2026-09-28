-- Ratings become a score rather than an average of reviews.
--
-- Three changes, in order:
--   1. `rating_avg` stops being nullable and starts at 5 — a listing nobody
--      has rated is not a bad listing, and the app now always has a number
--      to show.
--   2. Every existing row is recomputed with the live formula, so the column
--      means the same thing for old listings as for new ones.
--   3. Indexes for the two lookups RatingService does on every recompute.
--
-- The formula here is the SQL twin of src/modules/rating/rating.service.ts —
-- if you change the constants there, this file is only the backfill, and the
-- service rewrites every row it touches from then on anyway.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run.
--
--   psql "$DATABASE_URL" -f sql/2026-09-29-rating.sql

BEGIN;

-- 1 ------------------------------------------------------------------------
ALTER TABLE listings ALTER COLUMN rating_avg SET DEFAULT 5;
UPDATE listings SET rating_avg = 5 WHERE rating_avg IS NULL;
ALTER TABLE listings ALTER COLUMN rating_avg SET NOT NULL;

-- 2 ------------------------------------------------------------------------
-- PRIOR = 5, PRIOR_WEIGHT = 3, HALF_LIFE = 365d, DECAY_FLOOR = 0.25,
-- REPORT_STARS = 1, listing report weight 3, seller report weight 1 (cap 6).
WITH decay AS (
  SELECT 365.0 AS half_life, 0.25 AS floor
),
reviews AS (
  SELECT r.listing_id,
         SUM(GREATEST(d.floor, POWER(0.5, EXTRACT(EPOCH FROM (now() - r.created_at)) / 86400.0 / d.half_life)) * r.rating) AS weighted,
         SUM(GREATEST(d.floor, POWER(0.5, EXTRACT(EPOCH FROM (now() - r.created_at)) / 86400.0 / d.half_life)))            AS weight,
         COUNT(*)                                                                                                          AS count
    FROM listing_reviews r CROSS JOIN decay d
   GROUP BY r.listing_id
),
listing_reports_upheld AS (
  SELECT rep.listing_id,
         SUM(GREATEST(d.floor, POWER(0.5, EXTRACT(EPOCH FROM (now() - rep.created_at)) / 86400.0 / d.half_life))) AS weight
    FROM listing_reports rep CROSS JOIN decay d
   WHERE rep.status = 'RESOLVED'
   GROUP BY rep.listing_id
),
owner_reports_upheld AS (
  SELECT owner_id, SUM(weight) AS weight FROM (
    SELECT l.owner_id,
           GREATEST(d.floor, POWER(0.5, EXTRACT(EPOCH FROM (now() - rep.created_at)) / 86400.0 / d.half_life)) AS weight
      FROM listing_reports rep
      JOIN listings l ON l.id = rep.listing_id
      CROSS JOIN decay d
     WHERE rep.status = 'RESOLVED'
    UNION ALL
    SELECT CASE WHEN c.host_id = cr.reporter_id THEN c.guest_id ELSE c.host_id END AS owner_id,
           GREATEST(d.floor, POWER(0.5, EXTRACT(EPOCH FROM (now() - cr.created_at)) / 86400.0 / d.half_life)) AS weight
      FROM chat_reports cr
      JOIN conversations c ON c.id = cr.conversation_id
      CROSS JOIN decay d
     WHERE cr.status = 'RESOLVED'
  ) t
  GROUP BY owner_id
),
scored AS (
  SELECT l.id,
         COALESCE(rv.count, 0)::int AS review_count,
         (
           5 * 3
           + COALESCE(rv.weighted, 0)
           + COALESCE(lr.weight, 0) * 3 * 1
           + LEAST(GREATEST(COALESCE(orp.weight, 0) - COALESCE(lr.weight, 0), 0) * 1, 6) * 1
         )
         /
         (
           3
           + COALESCE(rv.weight, 0)
           + COALESCE(lr.weight, 0) * 3
           + LEAST(GREATEST(COALESCE(orp.weight, 0) - COALESCE(lr.weight, 0), 0) * 1, 6)
         ) AS score
    FROM listings l
    LEFT JOIN reviews                rv  ON rv.listing_id  = l.id
    LEFT JOIN listing_reports_upheld lr  ON lr.listing_id  = l.id
    LEFT JOIN owner_reports_upheld   orp ON orp.owner_id   = l.owner_id
)
UPDATE listings l
   SET rating_avg   = ROUND(LEAST(5, GREATEST(1, s.score))::numeric, 1),
       rating_count = s.review_count
  FROM scored s
 WHERE l.id = s.id;

-- 3 ------------------------------------------------------------------------
-- Every recompute reads upheld reports by listing and walks a conversation's
-- participants; both are index lookups with these.
CREATE INDEX IF NOT EXISTS idx_listing_reports_status_listing
  ON listing_reports (status, listing_id);
CREATE INDEX IF NOT EXISTS idx_chat_reports_status_conversation
  ON chat_reports (status, conversation_id);

COMMIT;
