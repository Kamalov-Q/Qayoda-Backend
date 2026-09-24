-- Support threads: one person's line to the support desk.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run: every statement is IF NOT
-- EXISTS. Index names are TypeORM's own, so `npm run schema:sql` stays quiet.
--
--   psql "$DATABASE_URL" -f sql/2026-09-25-support.sql

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS support_threads (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- One thread per person, reopened rather than duplicated: a queue where the
  -- same customer appears four times is a queue nobody can work.
  user_id         uuid        NOT NULL,
  status          varchar(20) NOT NULL DEFAULT 'OPEN',
  last_message_at timestamptz,
  user_unread     integer     NOT NULL DEFAULT 0,
  admin_unread    integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_support_thread_user UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS "IDX_33c3d54fa7458b1ee3395f5c41"
  ON support_threads (user_id);
CREATE INDEX IF NOT EXISTS "IDX_781c9aec4aa6db3b384d5deb63"
  ON support_threads (status);
CREATE INDEX IF NOT EXISTS "IDX_c526153dba7d602123c84e2f8e"
  ON support_threads (last_message_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  thread_id       uuid        NOT NULL,
  sender_id       uuid        NOT NULL,
  -- Stored, not derived: an admin who is later demoted must not retroactively
  -- turn every answer they wrote into a message from the customer.
  from_admin      boolean     NOT NULL DEFAULT false,
  body            text        NOT NULL,
  image_url       text,
  image_thumb_url text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_0275cf8d73cc01f87da8ffcf77"
  ON support_messages (thread_id);

COMMIT;
