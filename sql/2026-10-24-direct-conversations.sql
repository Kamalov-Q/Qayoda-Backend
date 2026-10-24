-- Messaging a person, not an advert.
--
-- Conversations were listing-scoped from the start: host is the listing's
-- owner, guest is whoever wrote, unique per (listing, guest). That is right
-- for the common case and wrong for the one the app now puts in front of
-- people — the sellers directory, where a profile with no live listing has
-- no thread to open and the Message button simply does not appear.
--
--   psql "$DATABASE_URL" -f sql/2026-10-24-direct-conversations.sql
--
-- Safe to re-run.

BEGIN;

-- Null means "about this person, not about an advert".
ALTER TABLE conversations
  ALTER COLUMN listing_id DROP NOT NULL;

-- The old constraint stops covering direct threads the moment listing_id can
-- be null: Postgres treats NULLs as distinct, so (NULL, guest) never
-- conflicts with itself and one pair could open unlimited empty threads.
--
-- Two indexes instead, each partial, so the two kinds of conversation are
-- each unique in their own terms.
-- Dropped by SHAPE, not by name: TypeORM generated it as a hash
-- (UQ_6d4066d6…), and that name is not something a migration should
-- hardcode or a reader should have to recognise.
DO $$
DECLARE c text;
BEGIN
  SELECT con.conname INTO c
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
   WHERE rel.relname = 'conversations'
     AND con.contype = 'u'
     AND (
       SELECT array_agg(att.attname::text ORDER BY att.attname::text)
         FROM unnest(con.conkey) k
         JOIN pg_attribute att
           ON att.attrelid = con.conrelid AND att.attnum = k
     ) = ARRAY['guest_id', 'listing_id'];

  IF c IS NOT NULL THEN
    EXECUTE format('ALTER TABLE conversations DROP CONSTRAINT %I', c);
  END IF;
END $$;

DROP INDEX IF EXISTS uq_conversations_listing_guest;
CREATE UNIQUE INDEX uq_conversations_listing_guest
  ON conversations (listing_id, guest_id)
  WHERE listing_id IS NOT NULL;

-- A direct thread is unique per PAIR, and ordered: whoever wrote first is
-- the guest. Without the ordering two people could each open one and end up
-- talking past each other in separate threads.
DROP INDEX IF EXISTS uq_conversations_direct_pair;
CREATE UNIQUE INDEX uq_conversations_direct_pair
  ON conversations (least(host_id, guest_id), greatest(host_id, guest_id))
  WHERE listing_id IS NULL;

COMMIT;
