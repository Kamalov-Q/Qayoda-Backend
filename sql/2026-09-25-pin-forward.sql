-- Pinned messages, forward provenance, and support attachments.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run: every statement is IF NOT
-- EXISTS. No indexes are added — nothing here is queried by these columns.
--
--   psql "$DATABASE_URL" -f sql/2026-09-25-pin-forward.sql

BEGIN;

-- One pin per conversation.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pinned_message_id uuid;

-- Where a forwarded message came from. The name is a snapshot, not a join: a
-- forward is a quotation and has to keep its attribution after the account
-- that wrote it is gone.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS forwarded_from_user_id uuid;
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS forwarded_from_name varchar(120);

-- Support threads must be able to hold anything a chat message can, because
-- anything in a chat can now be forwarded into one.
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS type varchar(20) NOT NULL DEFAULT 'TEXT';
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS media_url text;
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS file_name varchar(255);
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS file_size bigint;
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS mime_type varchar(128);
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS duration_sec integer;
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS waveform jsonb;
ALTER TABLE support_messages
  ADD COLUMN IF NOT EXISTS forwarded_from_name varchar(120);

COMMIT;
