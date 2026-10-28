-- Price negotiation: a buyer offers a number, the seller answers it.
--
-- The word "offer" was already taken: `listing_offers` is the asking price
-- the seller published. This is the other side of that conversation, so the
-- table is `price_bids` and nothing in it is called an offer.
--
-- A bid is a row rather than just a chat message because it has a lifecycle
-- a message does not — accepted, countered, withdrawn, lapsed. The message
-- in the thread is how it is SHOWN; the row is what it IS.
--
--   psql "$DATABASE_URL" -f sql/2026-10-28-price-bids.sql
--
-- Safe to re-run. No table is rewritten: everything here is a new table, a
-- nullable column and some indexes, so it takes no long lock on `messages`.

BEGIN;

CREATE TABLE IF NOT EXISTS price_bids (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),

  listing_id       uuid NOT NULL,
  -- The BUYER, on both directions. A seller's counter is still part of the
  -- buyer's negotiation, so (listing_id, bidder_id) identifies the whole
  -- exchange no matter who spoke last — which is what the partial unique
  -- index below can then key on.
  bidder_id        uuid NOT NULL,
  -- The seller at the time of bidding, snapshotted to save a join on every
  -- permission check.
  owner_id         uuid NOT NULL,

  conversation_id  uuid,
  message_id       uuid,

  direction        varchar(8)  NOT NULL,           -- BUYER | SELLER
  status           varchar(16) NOT NULL DEFAULT 'PENDING',
  purpose          varchar(16) NOT NULL,           -- SALE | RENT_MONTHLY | RENT_DAILY

  amount           numeric(14,2) NOT NULL,
  currency         char(3)       NOT NULL DEFAULT 'USD',
  -- Normalised at write time. Same reasoning as listing_offers.price_usd:
  -- comparing so'm against dollars is not a comparison. Nullable because a
  -- missing exchange rate must never stop somebody bidding.
  amount_usd       numeric(14,2),

  -- What was being asked at the time. The card says "−10% off 27 850 $" for
  -- as long as it exists; a join to the live price makes that sentence
  -- change under the reader when the seller edits it.
  asking_amount    numeric(14,2),
  asking_currency  char(3),

  expires_at       timestamptz NOT NULL,
  responded_at     timestamptz,
  superseded_by_id uuid,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One live offer per person per advert. Two live numbers from one bidder is
-- a question with two answers, and "accept" would have to ask which.
-- Partial, so the settled history is kept in full.
CREATE UNIQUE INDEX IF NOT EXISTS uq_price_bids_open_per_bidder
  ON price_bids (listing_id, bidder_id)
  WHERE status = 'PENDING';

-- The owner's view: what is open on this advert, newest first.
CREATE INDEX IF NOT EXISTS idx_price_bids_listing_status
  ON price_bids (listing_id, status, created_at);

-- The bidder's view: everything I have offered, anywhere.
CREATE INDEX IF NOT EXISTS idx_price_bids_bidder
  ON price_bids (bidder_id, created_at);

-- The hourly sweep. Partial: only PENDING rows can ever be due, so this
-- stays a handful of rows rather than the table. Declared the same way on
-- the entity, so `npm run schema:sql` stays quiet after this is applied.
CREATE INDEX IF NOT EXISTS idx_price_bids_expiry
  ON price_bids (expires_at)
  WHERE status = 'PENDING';

-- How a bid reaches the thread.
--
-- A nullable reference on `messages`, and NOT a new value in the message
-- type enum. The enum is what every client switches on, and a value none of
-- the builds already on people's phones has heard of renders as an empty
-- bubble in all of them. A bid is therefore an ordinary TEXT message whose
-- body reads as a sentence ("Narx taklifi: 25 065 $ (so'ralgan narxdan
-- −10%)"); old clients show that sentence, new ones see this column and
-- draw the card with its buttons instead. Nothing has to be upgraded for
-- the conversation to stay readable.
--
-- Adding a nullable column with no default is metadata-only on PG 11+, so
-- this does not rewrite the messages table.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS price_bid_id uuid;

CREATE INDEX IF NOT EXISTS idx_messages_price_bid
  ON messages (price_bid_id)
  WHERE price_bid_id IS NOT NULL;

-- ─────────────────────────── referential integrity ───────────────────────
--
-- This table shipped with six id columns and no foreign keys, which left
-- every one of them a uuid the database had no opinion about: nothing
-- stopped a bid being written against a listing that did not exist, and
-- nothing said what should happen to one if the row it points at went away.
--
-- Nothing in the application hard-deletes a listing, a user, a conversation
-- or a message — account deletion scrubs the row and sets deleted_at, and
-- archiving is this app's delete — so none of the CASCADEs below can fire
-- through normal use. They are here to define the answer for the paths that
-- do not go through the application: an admin statement, a data migration,
-- a real erasure request. The checks they do earn today are on INSERT.
--
-- ADD CONSTRAINT has no IF NOT EXISTS, hence the catalogue lookups. Named to
-- match the entity exactly, so `npm run schema:sql` stays quiet.
--
-- NOT VALID would skip the scan of existing rows, but this table is new and
-- small and every row in it was written by the service, so a validating add
-- is both quick and worth the confirmation.

DO $$
BEGIN
  -- The advert bid on. CASCADE: a bid on a listing that no longer exists is
  -- not a record of anything.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_bids_listing') THEN
    ALTER TABLE price_bids ADD CONSTRAINT fk_price_bids_listing
      FOREIGN KEY (listing_id) REFERENCES listings (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_bids_bidder') THEN
    ALTER TABLE price_bids ADD CONSTRAINT fk_price_bids_bidder
      FOREIGN KEY (bidder_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_bids_owner') THEN
    ALTER TABLE price_bids ADD CONSTRAINT fk_price_bids_owner
      FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;
  END IF;

  -- SET NULL for the two chat references: the bid is the record of a number
  -- having been offered, and that stays true whether or not the thread it
  -- was posted into still exists.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_bids_conversation') THEN
    ALTER TABLE price_bids ADD CONSTRAINT fk_price_bids_conversation
      FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_bids_message') THEN
    ALTER TABLE price_bids ADD CONSTRAINT fk_price_bids_message
      FOREIGN KEY (message_id) REFERENCES messages (id) ON DELETE SET NULL;
  END IF;

  -- Self-referential, so SET NULL is the only safe answer: CASCADE would let
  -- removing the newest counter take the whole negotiation behind it down
  -- the chain.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_price_bids_superseded_by') THEN
    ALTER TABLE price_bids ADD CONSTRAINT fk_price_bids_superseded_by
      FOREIGN KEY (superseded_by_id) REFERENCES price_bids (id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLOUT ORDER — read this before deploying.
--
-- The server gains five notification kinds (PRICE_BID_*). The app's inbox
-- screen indexes a FIXED map by kind, so a build that predates them will
-- throw on a row it does not recognise. Ship the mobile update FIRST, or
-- keep the bid endpoints unreachable until it is out. Nothing else here is
-- visible to an old client: the bid message is plain text to them.
-- ─────────────────────────────────────────────────────────────────────────
