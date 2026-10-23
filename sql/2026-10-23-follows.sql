-- Following people, and the two counters it keeps on the users row.
--
-- `synchronize` is off in production (see shared/database/typeorm.config.ts),
-- so this is the hand-applied version of what modules/follows/follow.entity
-- and the two new User columns would otherwise create. Safe to re-run.
--
--   psql "$DATABASE_URL" -f sql/2026-10-23-follows.sql
--
-- Directional and not mutual: there is no request to accept, because nothing
-- in this app is private enough to need one. A follow buys the Following tab
-- in the Videos feed and a number on a profile, and grants no access at all.

BEGIN;

CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  followee_id uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- The pair is the key: following twice is the same follow, and the second
  -- insert simply conflicts instead of counting again.
  PRIMARY KEY (follower_id, followee_id)
);

-- "Who follows this seller", for the profile list.
CREATE INDEX IF NOT EXISTS "IDX_follows_followee"
  ON follows (followee_id, created_at DESC);
-- "Whose videos should I see", for the Following feed's EXISTS.
CREATE INDEX IF NOT EXISTS "IDX_follows_follower"
  ON follows (follower_id, created_at DESC);

-- Denormalised counts. The rows above are the truth; these spare a COUNT on
-- every profile open, which is the most visited screen after the feed.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS follower_count  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count integer NOT NULL DEFAULT 0;

-- Backfill, in case follows were ever written before this ran.
UPDATE users u
   SET follower_count  = (SELECT count(*) FROM follows WHERE followee_id = u.id),
       following_count = (SELECT count(*) FROM follows WHERE follower_id = u.id)
 WHERE EXISTS (SELECT 1 FROM follows f
                WHERE f.followee_id = u.id OR f.follower_id = u.id);

COMMIT;
