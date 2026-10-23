-- Short-form video: the Videos tab, and the clip that can hang off a listing.
--
-- `synchronize` is off in production (see shared/database/typeorm.config.ts),
-- so this is the hand-applied version of what the entities under
-- modules/videos/entities would otherwise create. Safe to re-run: every
-- statement is IF NOT EXISTS, and the index names match the ones the
-- entities declare, so `npm run schema:sql` stays quiet afterwards.
--
--   psql "$DATABASE_URL" -f sql/2026-10-23-videos.sql
--
-- One table for both jobs on purpose. A video with `listing_id` set is the
-- advert's own clip AND a reel in the tab; a video without one is only a
-- reel. Two tables would have meant two upload pipelines, two moderation
-- queues and two sets of counters.

BEGIN;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS videos (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  author_id     uuid        NOT NULL,
  -- Optional: the listing this clip advertises. ON DELETE SET NULL rather
  -- than CASCADE — the video is still the author's work, and deleting a sold
  -- advert should not silently delete the film of it.
  listing_id    uuid REFERENCES listings (id) ON DELETE SET NULL,
  -- The Bunny Stream video GUID. The bytes never touch this server, so this
  -- id is the only handle we have on them.
  provider_id   varchar(64) NOT NULL,
  status        varchar(20) NOT NULL DEFAULT 'UPLOADING',
  fail_reason   varchar(32),
  caption       varchar(2200),
  -- Written from what Bunny reports about the encoded file, never from what
  -- the phone claimed: the 60-second rule is only a rule if the server
  -- measures it.
  duration_sec  real,
  width         integer,
  height        integer,
  thumbnail_file varchar(128),
  like_count    integer     NOT NULL DEFAULT 0,
  comment_count integer     NOT NULL DEFAULT 0,
  share_count   integer     NOT NULL DEFAULT 0,
  view_count    integer     NOT NULL DEFAULT 0,
  -- When it became public, i.e. when it was paid for. Null until then.
  published_at  timestamptz,
  -- What the feed actually sorts on: published_at plus a few hours of credit
  -- for a video that points at a listing. Stored rather than computed so the
  -- feed's keyset pagination can ride a plain b-tree index.
  rank_at       timestamptz,
  removed_at    timestamptz,
  removed_by    uuid,
  remove_reason varchar(255),
  -- When the file was deleted at Bunny. Set by the retention sweep, so a
  -- removed video can still be looked at in the dashboard for a month.
  provider_purged_at timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_videos_status" CHECK (status IN (
    'UPLOADING', 'AWAITING_PAYMENT', 'READY', 'FAILED', 'EXPIRED', 'REMOVED'
  ))
);

-- One row per Bunny object: the webhook finds its video by this, and a
-- duplicate would make "which of these two is the real one" a question.
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_videos_provider"
  ON videos (provider_id);

-- The feed: rank_at DESC, id DESC as the tie-break, over published rows only.
-- The partial WHERE keeps the index the size of the public catalogue rather
-- than of every failed upload ever attempted.
CREATE INDEX IF NOT EXISTS "IDX_videos_feed"
  ON videos (rank_at DESC, id DESC) WHERE status = 'READY';

-- "My videos", including the ones still processing, newest first.
CREATE INDEX IF NOT EXISTS "IDX_videos_author"
  ON videos (author_id, created_at DESC);

-- The clip on a listing page.
CREATE INDEX IF NOT EXISTS "IDX_videos_listing"
  ON videos (listing_id, published_at DESC) WHERE status = 'READY';

-- The sweeps: abandoned uploads, unpaid videos, lost webhooks, retention.
CREATE INDEX IF NOT EXISTS "IDX_videos_pending"
  ON videos (status, updated_at);

CREATE TABLE IF NOT EXISTS video_likes (
  video_id   uuid        NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- The pair is the key, which is what makes a double tap one like without
  -- a read-then-write: the second insert simply conflicts.
  PRIMARY KEY (video_id, user_id)
);

-- "Videos you liked", and the only index that direction needs.
CREATE INDEX IF NOT EXISTS "IDX_video_likes_user"
  ON video_likes (user_id, created_at DESC);

-- One row per viewer per video, so view_count means "how many people", not
-- "how many times it looped". Signed-in viewers are keyed by user id and
-- follow themselves across devices; guests are keyed by the device id the
-- app generates once — the same scheme as listing_views.
CREATE TABLE IF NOT EXISTS video_views (
  video_id   uuid        NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  viewer_key varchar(80) NOT NULL,
  user_id    uuid,
  -- How long they actually watched, in milliseconds, as last reported. Kept
  -- for ranking later ("watch-through"), not shown anywhere yet.
  watched_ms integer     NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (video_id, viewer_key)
);

CREATE INDEX IF NOT EXISTS "IDX_video_views_user"
  ON video_views (user_id, created_at DESC);

-- Comments under a reel. Deliberately its own table rather than a
-- target_type column bolted onto listing_comments: a listing thread is
-- moderated by the listing's owner and pushed over the listings websocket,
-- and neither of those is true here. See the implementation guide for the
-- consolidation that is still worth doing.
CREATE TABLE IF NOT EXISTS video_comments (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id    uuid        NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  author_id   uuid        NOT NULL,
  -- Null for a top-level comment. One level only, like Instagram: the
  -- service refuses a reply whose parent is itself a reply.
  parent_id   uuid REFERENCES video_comments (id) ON DELETE CASCADE,
  body        varchar(1000) NOT NULL,
  like_count  integer     NOT NULL DEFAULT 0,
  reply_count integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The thread, newest first.
CREATE INDEX IF NOT EXISTS "IDX_video_comments_video"
  ON video_comments (video_id, created_at DESC);
CREATE INDEX IF NOT EXISTS "IDX_video_comments_parent"
  ON video_comments (parent_id, created_at);
CREATE INDEX IF NOT EXISTS "IDX_video_comments_author"
  ON video_comments (author_id, created_at DESC);

CREATE TABLE IF NOT EXISTS video_comment_likes (
  comment_id uuid        NOT NULL REFERENCES video_comments (id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE INDEX IF NOT EXISTS "IDX_video_comment_likes_user"
  ON video_comment_likes (user_id, created_at DESC);

-- The moderation queue. Everyone can post, so this is not an optional extra:
-- without a report button, the first problem video is one the team hears
-- about by telephone.
CREATE TABLE IF NOT EXISTS video_reports (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id        uuid        NOT NULL REFERENCES videos (id) ON DELETE CASCADE,
  reporter_id     uuid        NOT NULL,
  reason          varchar(40) NOT NULL,
  comment         text,
  status          varchar(20) NOT NULL DEFAULT 'OPEN',
  resolved_by     uuid,
  resolution_note varchar(255),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- One report per person per video: the count means "how many people", not
  -- "how many taps", and this constraint is what actually enforces it.
  CONSTRAINT uq_video_report_reporter UNIQUE (video_id, reporter_id),
  CONSTRAINT "CHK_video_reports_status" CHECK (
    status IN ('OPEN', 'RESOLVED', 'DISMISSED')
  )
);

CREATE INDEX IF NOT EXISTS "IDX_video_reports_video"
  ON video_reports (video_id);
CREATE INDEX IF NOT EXISTS "IDX_video_reports_reporter"
  ON video_reports (reporter_id);
-- The queue itself: open ones, oldest complaint first.
CREATE INDEX IF NOT EXISTS "IDX_video_reports_status"
  ON video_reports (status, created_at);

COMMIT;
