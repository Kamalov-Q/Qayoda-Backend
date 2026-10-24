-- The in-app inbox, and letting a report point at a comment.
--
--   psql "$DATABASE_URL" -f sql/2026-10-24-notifications-and-comment-reports.sql
--
-- Safe to re-run. Nothing is dropped and nothing is rewritten; the one
-- destructive-looking line is a unique constraint being replaced by a wider
-- one, which can only ever allow more rows than before.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- One thing worth telling somebody about. Rows a client reads, not pushes a
-- device receives: there is no push infrastructure here yet, and an inbox is
-- the half that has to exist either way — a push with nothing to open
-- afterwards is a notification that happened to you rather than for you.
CREATE TABLE IF NOT EXISTS user_notifications (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- Who is being told.
  user_id    uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       varchar(32) NOT NULL,
  -- Who did it. Null when the platform is the actor, as when a video of
  -- yours finishes encoding.
  actor_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  video_id   uuid REFERENCES videos (id) ON DELETE CASCADE,
  comment_id uuid REFERENCES video_comments (id) ON DELETE CASCADE,
  -- Null until opened.
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- The inbox itself: one person's, newest first.
CREATE INDEX IF NOT EXISTS "IDX_notifications_user"
  ON user_notifications (user_id, created_at DESC);

-- The dot on the bell. Partial, because "unread" is a small slice of a table
-- that only grows — and it is read on every app launch.
CREATE INDEX IF NOT EXISTS "IDX_notifications_unread"
  ON user_notifications (user_id) WHERE read_at IS NULL;

-- A report can now be about one comment rather than the whole clip. Same
-- queue, same six reasons, same two buttons: whoever reviews a reel is the
-- person who reviews what is written under it.
ALTER TABLE video_reports
  ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES video_comments (id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "IDX_video_reports_comment"
  ON video_reports (comment_id) WHERE comment_id IS NOT NULL;

-- One report per person per TARGET, in two parts.
--
-- The old constraint was per person per video, which would have let somebody's
-- first comment report block every later one about the same reel. Widening it
-- to include comment_id fixes that for comments — but Postgres counts NULLs as
-- distinct, so on its own it would stop catching duplicate VIDEO reports,
-- where comment_id is null. Hence the partial unique index beside it.
ALTER TABLE video_reports DROP CONSTRAINT IF EXISTS uq_video_report_reporter;
ALTER TABLE video_reports
  ADD CONSTRAINT uq_video_report_reporter
  UNIQUE (video_id, reporter_id, comment_id);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_video_report_video"
  ON video_reports (video_id, reporter_id) WHERE comment_id IS NULL;

COMMIT;
