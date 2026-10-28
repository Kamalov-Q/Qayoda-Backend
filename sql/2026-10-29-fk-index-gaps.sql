-- Four foreign keys with no index, and one default that should not exist.
--
--   psql "$DATABASE_URL" -f sql/2026-10-29-fk-index-gaps.sql
--
-- Found by sql/checks/2026-10-28-preflight.sql on production, where check #9
-- ("no unindexed foreign keys anywhere") failed after the 2026-10-28 deploy.
-- It passed on dev, and the reason it passed is the important part:
-- `synchronize` is on outside production and silently creates every index the
-- entities declare, so an index that exists only as an entity declaration is
-- present on dev and absent in production. These four were never declared
-- anywhere, so they were missing on both — dev just never had a reason to say
-- so, because nothing there deletes enough rows to notice.
--
-- Postgres indexes the REFERENCED side of a foreign key, never the
-- referencing side. Without these, deleting one user scans the whole of
-- user_notifications three times (actor, video, comment) plus listing_videos.
--
-- All four are also declared on their entities (UserNotification,
-- ListingVideo), which they must be or `synchronize` will drop them again.
--
-- CONCURRENTLY, so this does not take a write lock on a live table — which
-- means it CANNOT run inside a transaction. Do not wrap it. A failed CREATE
-- leaves an INVALID index behind; drop it before retrying.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_actor
  ON user_notifications (actor_id) WHERE actor_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_video
  ON user_notifications (video_id) WHERE video_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_notifications_comment
  ON user_notifications (comment_id) WHERE comment_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listing_videos_owner
  ON listing_videos (owner_id);

-- Drift introduced by sql/2026-10-28-listing-sales.sql, which created this
-- column with DEFAULT now() while the ListingSale entity declares a plain
-- column. typeorm schema:log asks to drop it on every run, and on a database
-- with synchronize on it would simply be dropped. The service always sets
-- sold_at explicitly, so nothing relies on the default.
--
-- The .sql file has been corrected too, so a database built from scratch
-- never grows the default in the first place.
ALTER TABLE listing_sales ALTER COLUMN sold_at DROP DEFAULT;
