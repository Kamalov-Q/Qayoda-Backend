-- Two changes to short-form video, both driven by how the feature actually
-- gets used:
--
--   1. Comments under a reel can carry a photo, the same way a listing's
--      comments can. Someone asking "is this the kitchen on the left?" is
--      usually holding a screenshot of it.
--   2. Share counting goes. The native share sheet never reports whether
--      anything was actually sent, so the number counted intent while being
--      read as reach — and nothing in the product acts on it.
--
--   psql "$DATABASE_URL" -f sql/2026-10-24-video-comment-images.sql
--
-- Safe to re-run. The DROP is the one irreversible line here; the column held
-- nothing but zeros, since the app never shipped a screen that displayed it.

BEGIN;

ALTER TABLE video_comments
  ADD COLUMN IF NOT EXISTS image_url       text,
  ADD COLUMN IF NOT EXISTS image_thumb_url text,
  ADD COLUMN IF NOT EXISTS image_width     integer,
  ADD COLUMN IF NOT EXISTS image_height    integer;

-- A photo on its own is a comment, so the body stops being the only way to
-- have one. Existing rows all have text; the default keeps the column
-- NOT NULL without making every insert spell out an empty string.
ALTER TABLE video_comments
  ALTER COLUMN body SET DEFAULT '';

ALTER TABLE videos DROP COLUMN IF EXISTS share_count;

COMMIT;
