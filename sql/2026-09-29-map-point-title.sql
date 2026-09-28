-- The map's search box is labelled "title or address" and only matched
-- addresses once the map zoomed out far enough to draw points: that query
-- reads the `listing_map_points` projection, which carried no title.
--
-- Adds the column and backfills it from the listings themselves, so old rows
-- are searchable without waiting for each listing to be edited. The listener
-- writes it from now on (ProjectMapPointListener).
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run.
--
--   psql "$DATABASE_URL" -f sql/2026-09-29-map-point-title.sql

BEGIN;

ALTER TABLE listing_map_points ADD COLUMN IF NOT EXISTS title text;

UPDATE listing_map_points p
   SET title = l.title
  FROM listings l
 WHERE l.id = p.listing_id
   AND p.title IS DISTINCT FROM l.title;

COMMIT;
