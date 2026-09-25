-- Blocking between users.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run: every statement is IF NOT
-- EXISTS. Index names are TypeORM's own so `npm run schema:sql` stays quiet.
--
--   psql "$DATABASE_URL" -f sql/2026-09-25-user-blocks.sql

BEGIN;

CREATE TABLE IF NOT EXISTS user_blocks (
  -- The pair is the key: blocking twice is the same block, not a second row.
  blocker_id uuid        NOT NULL,
  blocked_id uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id)
);

-- Both directions are asked constantly — "who have I blocked" for the list,
-- and "is there a block between these two" before every message.
CREATE INDEX IF NOT EXISTS "IDX_dfcd8a81016d1de587fbd2d70b"
  ON user_blocks (blocker_id);
CREATE INDEX IF NOT EXISTS "IDX_7a0806a54f0ad9ced3e247cacd"
  ON user_blocks (blocked_id);

COMMIT;
