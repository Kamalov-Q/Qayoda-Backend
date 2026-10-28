-- What a listing sold for, and the sold pin staying on the map.
--
-- Two changes, one feature:
--
--  1. listing_sales — the agreed price, against the asking price as it stood
--     at that moment. A table rather than columns on `listings`, because
--     GET /listings/:id is public, unguarded, and answers with the whole
--     entity spread (`{ ...listing, owner }`) through no serializer. A
--     sold_price column there would be world-readable the day it was added.
--     See the entity for the rest of the reasoning.
--
--  2. listing_map_points.sold — a sold advert used to be DELETED from the map
--     projection. The pin stays now and is drawn in a different colour, so
--     the record of where a sale happened survives. `price` on a sold row
--     remains the ASKING price: the viewport endpoint is public and a
--     seller's negotiated figure is not.
--
-- Idempotent. Safe to re-run.
--
-- Every object here is also declared on its entity (ListingSale,
-- ListingMapPoint) — it has to be, because `synchronize` is on outside
-- production and drops anything the entities do not know about.

CREATE TABLE IF NOT EXISTS listing_sales (
  -- PK, not a surrogate: a listing sells once, and relisting then selling
  -- again overwrites. The question is "what did it go for", not "what is its
  -- sales history".
  listing_id        uuid PRIMARY KEY,
  owner_id          uuid           NOT NULL,
  -- WHICH offer sold. A listing can carry a sale price and a monthly rent at
  -- once, and comparing a sale against a rent asking price is not a
  -- comparison — it is a bug that produces a plausible number.
  purpose           varchar(16)    NOT NULL,
  price             numeric(14,2)  NOT NULL,
  currency          char(3)        NOT NULL,
  price_usd         numeric(14,2),
  -- Snapshotted, never re-read off the offer. The seller can edit the price
  -- afterwards, and a comparison whose baseline moves rewrites history.
  asking_price      numeric(14,2),
  asking_currency   char(3),
  asking_price_usd  numeric(14,2),
  -- No DEFAULT. The entity declares a plain column and the service always
  -- sets this explicitly (a relisted listing selling again is an UPDATE, and
  -- a create-timestamp would not fire on one). A default here that the
  -- entity does not know about is schema drift: typeorm schema:log asks to
  -- DROP it, and on a database where synchronize is on it would be dropped
  -- without asking.
  sold_at           timestamptz    NOT NULL
);

-- ADD CONSTRAINT has no IF NOT EXISTS, so it is guarded by name.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_listing_sales_listing'
  ) THEN
    ALTER TABLE listing_sales
      ADD CONSTRAINT fk_listing_sales_listing
      FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Reporting groups by date; the owner index is for the seller's own list.
CREATE INDEX IF NOT EXISTS idx_listing_sales_sold_at ON listing_sales (sold_at);
CREATE INDEX IF NOT EXISTS idx_listing_sales_owner   ON listing_sales (owner_id);

-- The map pin that stays.
ALTER TABLE listing_map_points
  ADD COLUMN IF NOT EXISTS sold boolean NOT NULL DEFAULT false;

-- Partial: the overwhelming majority of pins are not sold, so the index only
-- has to carry the ones that are.
CREATE INDEX IF NOT EXISTS idx_listing_map_points_sold
  ON listing_map_points (sold) WHERE sold;

-- Backfill: any listing already marked SOLD that still has a pin. There are
-- none in production yet (SOLD shipped the same day as this), but running it
-- makes the file correct on a database where that is not true.
UPDATE listing_map_points p
   SET sold = true
  FROM listings l
 WHERE l.id = p.listing_id
   AND l.status = 'SOLD'
   AND p.sold = false;
