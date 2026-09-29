-- Removes the second copy of every listing the seed posted twice.
--
-- `npm run seed:listings` used to create its ten listings unconditionally, so
-- a second run made a second copy of each: same owner, same title, same
-- coordinates, a different id. On the map the two markers sit exactly on top
-- of one another, so the pair reads as one advert while every count says two.
-- The seed script now leaves listings it has already posted alone.
--
-- ARCHIVES rather than deletes: a listing may already have a review, a
-- comment or a conversation hanging off it, and this is not the place to
-- decide what happens to those. Archived listings leave the map and the feed
-- immediately; run the DELETE at the bottom by hand later if you want them
-- gone for good.
--
-- The COPY IT KEEPS is the oldest, which is the one people have been looking
-- at — it carries the views, the reviews and any conversation.
--
-- WHAT COUNTS AS A COPY is deliberately strict: the same owner, title, point,
-- room count, area, floor, storeys AND description. Two flats in one building
-- are a perfectly ordinary thing to advertise, and they differ in at least
-- one of those — a floor, a price, a line of description. Anything that
-- differs anywhere is left alone, even if both pins sit on the same roof;
-- the map draws those as one bubble with a count, which is the honest way to
-- show them.
--
--   psql "$DATABASE_URL" -f sql/2026-09-30-dedupe-seed-listings.sql

BEGIN;

-- What is about to change, so the run says something.
WITH ranked AS (
  SELECT id, title, owner_id, created_at,
         ROW_NUMBER() OVER (
           PARTITION BY owner_id, title, ST_AsText(centroid::geometry),
                        rooms, area_m2, floor, total_floors, description_text
           ORDER BY created_at ASC
         ) AS copy_number
    FROM listings
   WHERE status = 'ACTIVE' AND title IS NOT NULL AND centroid IS NOT NULL
)
SELECT copy_number - 1 AS duplicates_of_this_listing, title
  FROM ranked
 WHERE copy_number > 1
 ORDER BY title;

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY owner_id, title, ST_AsText(centroid::geometry),
                        rooms, area_m2, floor, total_floors, description_text
           ORDER BY created_at ASC
         ) AS copy_number
    FROM listings
   WHERE status = 'ACTIVE' AND title IS NOT NULL AND centroid IS NOT NULL
)
UPDATE listings l
   SET status = 'ARCHIVED', updated_at = now()
  FROM ranked r
 WHERE l.id = r.id AND r.copy_number > 1;

-- The map reads its own projection, which only the archive event would clear
-- — and this went round the service, so clear it here.
DELETE FROM listing_map_points p
 USING listings l
 WHERE l.id = p.listing_id AND l.status <> 'ACTIVE';

COMMIT;

-- Afterwards, to be rid of them entirely (check what you are deleting first):
--
--   DELETE FROM listings WHERE status = 'ARCHIVED' AND id IN (…);
