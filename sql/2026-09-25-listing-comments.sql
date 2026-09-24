-- The comment thread under a listing, plus its likes.
--
-- `synchronize` is off in production (see shared/database/typeorm.config.ts),
-- so this is the hand-applied version of what it would have created. Safe to
-- re-run: every statement is IF NOT EXISTS.
--
--   psql "$DATABASE_URL" -f sql/2026-09-25-listing-comments.sql
--
-- The index names are TypeORM's own, computed with its naming strategy
-- (sha1(table_column) truncated to 26). They are not readable, and that is
-- the point: an index under any other name makes `npm run schema:sql` report
-- a permanent DROP/CREATE pair that drowns out real drift. The unnamed
-- PRIMARY KEY constraints are fine — TypeORM only checks that one exists.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS listing_comments (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  listing_id  uuid        NOT NULL,
  author_id   uuid        NOT NULL,
  -- Null for a top-level comment. One level only; the service refuses a
  -- reply whose parent is itself a reply.
  parent_id   uuid,
  body        text        NOT NULL,
  like_count  integer     NOT NULL DEFAULT 0,
  reply_count integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "IDX_464a016a9c01ef69dbc4f9fdd8"
  ON listing_comments (listing_id);
CREATE INDEX IF NOT EXISTS "IDX_8abfbb6e0d7d6f1d82b97ac315"
  ON listing_comments (author_id);
CREATE INDEX IF NOT EXISTS "IDX_cf12d5dc90a725ca4daf7056a9"
  ON listing_comments (parent_id);

-- One heart per person per comment: the pair IS the primary key, so a double
-- tap conflicts instead of counting twice.
CREATE TABLE IF NOT EXISTS listing_comment_likes (
  comment_id uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

COMMIT;
