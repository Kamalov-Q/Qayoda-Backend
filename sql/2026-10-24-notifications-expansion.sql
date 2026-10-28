-- Notifications stop being a video feature.
--
-- The inbox shipped covering reels only: a clip encoding, somebody liking or
-- commenting on one, a new follower. Everything else the app does — the
-- listings that are its actual product, the chat people close deals in, the
-- money moving through the wallet — happened silently.
--
-- This adds the references those events need and nothing else; the kinds
-- themselves are a varchar, so new ones need no schema change.
--
--   psql "$DATABASE_URL" -f sql/2026-10-24-notifications-expansion.sql
--
-- Safe to re-run.

BEGIN;

ALTER TABLE user_notifications
  -- Listing comments, replies and reviews. The comment itself already has a
  -- column; this is what it hangs off, and what the row has to open.
  ADD COLUMN IF NOT EXISTS listing_id      uuid,
  -- Chat. One row per CONVERSATION, not per message — see the partial index
  -- below and the dedupe in UserNotificationsService.
  ADD COLUMN IF NOT EXISTS conversation_id uuid,
  -- Money. A top-up's amount and provider, a tariff's name: facts the row
  -- prints and nothing else joins to, so a column each would be four columns
  -- that are null on every other kind.
  ADD COLUMN IF NOT EXISTS meta            jsonb;

-- A chat notification is "this conversation has something in it", not "this
-- message arrived". Fifty messages in one thread is one claim on attention,
-- and fifty rows is how an inbox teaches people to stop opening it.
--
-- Partial and unique on the unread ones only: once read, the row is history
-- and the next message is allowed to start a fresh one.
--
-- `kind = 'CHAT_MESSAGE'` was added by
-- sql/2026-10-28-unread-conversation-index-chat-only.sql and is repeated here
-- so a database built from scratch gets the right index first time. Without
-- it the predicate also caught every other kind carrying a conversation_id —
-- which, once price bids existed, silently dropped every offer notification
-- after the first in a thread. See that file for the whole story.
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_unread_conversation
  ON user_notifications (user_id, conversation_id)
  WHERE conversation_id IS NOT NULL
    AND read_at IS NULL
    AND kind = 'CHAT_MESSAGE';

-- The same shape of claim for a listing: several people commenting on one ad
-- is one thing to look at. Not unique — a reply to YOUR comment is a
-- different event from a comment on your listing, so the kind is in the key.
CREATE INDEX IF NOT EXISTS idx_notifications_listing
  ON user_notifications (user_id, listing_id, kind)
  WHERE listing_id IS NOT NULL;

COMMIT;
