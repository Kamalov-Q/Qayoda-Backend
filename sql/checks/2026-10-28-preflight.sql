-- Read-only. Reports which of the 2026-10-28 changes a database already has.
--
--   psql "$DATABASE_URL" -f sql/checks/2026-10-28-preflight.sql
--
-- There is no migration-tracking table in this project — the sql/ files are
-- applied by hand — so the only trustworthy answer to "has this been run?" is
-- to look at the schema. This looks.
--
-- Every row is one object a migration creates. `file` is the file that
-- creates it, so any MISSING row tells you exactly what to run. Touches
-- nothing: SELECTs against the catalogs only.

WITH checks(ord, file, object, present) AS (
  VALUES
    -- 2026-10-24-notifications-expansion.sql — a PREREQUISITE for the
    -- chat-only index below. Listed first because it is the one most likely
    -- to be missing: `synchronize` dropped both of its indexes on dev.
    (1, '2026-10-24-notifications-expansion', 'user_notifications.meta column',
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'user_notifications' AND column_name = 'meta')),
    (2, '2026-10-24-notifications-expansion', 'idx_notifications_listing',
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_notifications_listing')),

    -- 2026-10-28-price-bids.sql
    (3, '2026-10-28-price-bids', 'price_bids table',
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'price_bids')),
    (4, '2026-10-28-price-bids', 'all 6 price_bids foreign keys',
      (SELECT count(*) FROM pg_constraint
        WHERE contype = 'f' AND conrelid = to_regclass('price_bids')) >= 6),

    -- 2026-10-28-unread-conversation-index-chat-only.sql
    -- Presence is not enough here: the OLD, broken version of this index has
    -- the same name. The predicate is what distinguishes them, and getting
    -- the old one silently dropped every bid notification after the first in
    -- a thread. So this asserts the predicate mentions the kind.
    (5, '2026-10-28-unread-conversation-index-chat-only',
        'uq_notifications_unread_conversation narrowed to CHAT_MESSAGE',
      EXISTS (SELECT 1 FROM pg_indexes
               WHERE indexname = 'uq_notifications_unread_conversation'
                 AND indexdef LIKE '%CHAT_MESSAGE%')),

    -- 2026-10-28-listing-sold.sql — must be committed BEFORE the two files
    -- below, which both compare status against the 'SOLD' label.
    (6, '2026-10-28-listing-sold', 'SOLD on listings_status_enum',
      EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
               WHERE t.typname = 'listings_status_enum' AND e.enumlabel = 'SOLD')),

    -- 2026-10-28-missing-fk-indexes.sql
    (7, '2026-10-28-missing-fk-indexes', 'idx_listing_images_listing',
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_listing_images_listing')),
    (8, '2026-10-28-missing-fk-indexes', 'idx_price_bids_owner',
      EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_price_bids_owner')),
    (9, '2026-10-28-missing-fk-indexes', 'no unindexed foreign keys anywhere',
      NOT EXISTS (
        SELECT 1 FROM pg_constraint c
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
          AND NOT EXISTS (SELECT 1 FROM pg_index i
                           WHERE i.indrelid = c.conrelid
                             AND i.indkey[0] = c.conkey[1]))),

    -- 2026-10-28-listing-sales.sql
    (10, '2026-10-28-listing-sales', 'listing_sales table',
      EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'listing_sales')),
    (11, '2026-10-28-listing-sales', 'fk_listing_sales_listing',
      EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_listing_sales_listing')),
    (12, '2026-10-28-listing-sales', 'listing_map_points.sold column',
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'listing_map_points' AND column_name = 'sold')),

    -- 2026-10-28-pause-promotion-while-down.sql
    (13, '2026-10-28-pause-promotion-while-down', 'listings.promotion_remaining_seconds',
      EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'listings'
                 AND column_name = 'promotion_remaining_seconds'))
)
SELECT ord AS "#",
       CASE WHEN present THEN 'ok' ELSE 'MISSING' END AS status,
       object,
       CASE WHEN present THEN '' ELSE file END AS "run this file"
  FROM checks
 ORDER BY ord;

-- Left to burn: adverts already down with a promotion still running. The
-- pause migration's backfill repairs exactly these, so a non-zero count here
-- BEFORE it runs is expected, and it must be zero after.
SELECT count(*) AS promotions_still_burning_on_down_listings
  FROM listings
 WHERE status IN ('ARCHIVED', 'SOLD')
   AND promoted_until > now();

-- Invalid indexes. CREATE INDEX CONCURRENTLY leaves one behind when it fails,
-- and an invalid index is not used by any query while still being maintained
-- on every write. Must be empty; drop anything listed and re-run its file.
SELECT indexrelid::regclass AS invalid_index
  FROM pg_index WHERE NOT indisvalid;
