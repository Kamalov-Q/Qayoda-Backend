-- Narrow uq_notifications_unread_conversation to chat, which is all it ever
-- meant.
--
--   psql "$DATABASE_URL" -f sql/2026-10-28-unread-conversation-index-chat-only.sql
--
-- THE BUG
--
-- The index was added to collapse chat: "this conversation has something in
-- it", not "this message arrived", so fifty messages in one thread stay one
-- row and one push. Its predicate, though, was every unread row carrying a
-- conversation_id — and from 2026-10-28 the five PRICE_BID_* kinds carry one
-- too, because an offer belongs to the thread it was posted into.
--
-- Chat gets away with that: its insert is an ON CONFLICT DO UPDATE against
-- this exact index, so a second message touches the first row. A bid
-- notification is an ordinary insert, and a second offer in the same thread
-- therefore hit a plain unique violation. UserNotificationsService.notify()
-- catches and logs rather than throwing into its caller — correctly, a bid
-- must not fail because its notification did — so the row was dropped in
-- silence, and with it the push, because pushFor runs after the write.
--
-- A seller who had not yet opened their bell was told about the first offer
-- in a thread and about none of the ones after it.
--
-- It went unseen in development because `synchronize` had already dropped
-- this index there (it was never declared on the entity), so the collision
-- could not happen locally. Restoring the index without this change is what
-- would have turned a masked bug into a live one.
--
-- Bids must NOT collapse: each is a distinct number on the table and the one
-- you are not told about is the one you do not answer.
--
-- DROP then CREATE, not CREATE IF NOT EXISTS: the old index already exists
-- with the wider predicate, so a conditional create would skip and leave it.
-- Both statements are safe to re-run.

BEGIN;

DROP INDEX IF EXISTS uq_notifications_unread_conversation;

CREATE UNIQUE INDEX uq_notifications_unread_conversation
  ON user_notifications (user_id, conversation_id)
  WHERE conversation_id IS NOT NULL
    AND read_at IS NULL
    AND kind = 'CHAT_MESSAGE';

COMMIT;

-- The matching ON CONFLICT predicate lives in
-- UserNotificationsService.notify(). Postgres infers the arbiter index from
-- it, and an inference that no longer implies this predicate stops matching
-- the index entirely — which raises 42P10 on every chat notification. The
-- two are one change.
