-- TOP days stop burning while an advert is down.
--
-- The bug: every feed, map and search query filters to `status = 'ACTIVE'`,
-- but `promoted_until` kept running on listings that were SOLD or ARCHIVED.
-- A seller who sold on day three of a seven-day TOP package paid for four
-- days of placement that could not reach anybody. Nobody was charged twice,
-- which is exactly why it went unnoticed — and it got worse once a sold pin
-- stayed on the map, since such a listing was then paying for feed placement
-- it did not get while sitting on the map for free.
--
-- The fix: taking an advert down moves the REMAINDER into
-- promotion_remaining_seconds and clears promoted_until; restoring it does
-- the reverse, from now(). Seconds rather than an end date, because what was
-- bought is a duration — an end date parked across an archive of unknown
-- length means nothing by the time it is read.
--
-- promoted_until going NULL is deliberately the same null as "never
-- promoted", so the feed's ranking expression, the card badge and the detail
-- badge all treat a paused promotion as not promoted without knowing pausing
-- exists. A separate flag to check is a flag somebody forgets to check.
--
-- Idempotent. Safe to re-run: the backfill only touches rows that are still
-- in the broken state.
--
-- Declared on the Listing entity too — `synchronize` is on outside
-- production and drops what the entities do not know about.

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS promotion_remaining_seconds integer;

-- Backfill: every advert already down with a promotion still running. This is
-- the one-off repair; the service keeps it true from here.
--
-- An ALREADY EXPIRED promoted_until is left alone, here and in the service: a
-- past date is how the admin queue knows somebody paid once and may pay
-- again, and banking zero seconds over it would erase that signal.
UPDATE listings
   SET promotion_remaining_seconds = GREATEST(
         CEIL(EXTRACT(EPOCH FROM (promoted_until - now()))),
         1
       )::int,
       promoted_until = NULL
 WHERE status IN ('SOLD', 'ARCHIVED')
   AND promoted_until > now()
   AND promotion_remaining_seconds IS NULL;
