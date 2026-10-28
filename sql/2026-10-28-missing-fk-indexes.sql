-- Indexes on referencing columns that had none.
--
-- Postgres indexes the REFERENCED side of a foreign key (it is a primary or
-- unique key) and not the referencing side. Nothing warns about it, and the
-- cost only shows up under load:
--
--  * listing_images.listing_id — pre-existing, and on the hottest path there
--    is. `relations: { images: true }` compiles to WHERE listing_id IN (...),
--    so every feed page, card list and map preview seq-scanned the table.
--    The ON DELETE CASCADE did too, once per listing removed.
--  * price_bids.owner_id — listMine (/me/bids, the negotiations screen) asks
--    for `bidder_id = me OR owner_id = me`. Only the bidder half was indexed,
--    so a seller's own list of offers was a full scan.
--  * price_bids.conversation_id / message_id / superseded_by_id — not read by
--    any query, but each carries an ON DELETE SET NULL added in
--    2026-10-28-price-bids.sql, and finding the children of a deleted
--    conversation without an index is a full scan per delete.
--
-- CONCURRENTLY so this can be applied to a live database without taking a
-- write lock on the tables. That means it CANNOT run inside a transaction —
-- do not wrap this file in BEGIN/COMMIT, and if a CREATE fails it leaves an
-- INVALID index behind that must be dropped before retrying.
--
-- Every index here is also declared on its entity (ListingImage, PriceBid).
-- It has to be: `synchronize` is on outside production and drops any index
-- the entities do not know about — that is exactly how the two notification
-- indexes went missing.

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_listing_images_listing
  ON listing_images (listing_id, is_primary, position);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_bids_owner
  ON price_bids (owner_id, created_at);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_bids_conversation
  ON price_bids (conversation_id) WHERE conversation_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_bids_message
  ON price_bids (message_id) WHERE message_id IS NOT NULL;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_price_bids_superseded_by
  ON price_bids (superseded_by_id) WHERE superseded_by_id IS NOT NULL;
