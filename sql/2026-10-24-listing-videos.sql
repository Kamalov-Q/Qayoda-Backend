-- The walkthrough film on an advert.
--
-- Its own table, not a flag on `videos`. A reel is a published, paid, ranked
-- post with likes, comments, views and a moderation queue; a tour is a photo
-- of the property that happens to move. They share an upload pipeline and
-- nothing else — including lifetime: deleting a listing deletes its tour,
-- which is right for a photo and wrong for somebody's published post.
--
-- One per listing: listing_id is unique. Replacing the video deletes the row
-- and the Bunny object, so a listing never holds two files.

BEGIN;

CREATE TABLE IF NOT EXISTS listing_videos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id     uuid NOT NULL REFERENCES listings (id) ON DELETE CASCADE,
  -- Copied from the listing so "is this yours" is not a join.
  owner_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  -- The Bunny Stream GUID: the only handle on the actual bytes.
  provider_id    varchar(64) NOT NULL,
  status         varchar(20) NOT NULL DEFAULT 'UPLOADING',
  fail_reason    varchar(32),
  -- As Bunny measured the ENCODED file. The 3-minute limit is checked
  -- against this, never against what the phone claimed.
  duration_sec   real,
  width          int,
  height         int,
  thumbnail_file varchar(128),
  -- Stored, not derived: this row rides out as a plain relation on the
  -- listing, so the gallery can only read what is in a column.
  hls_url        text,
  thumb_url      text,
  ready_at       timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- One tour per listing, and one row per Bunny object. Both are unique
-- indexes rather than constraints so the names match the entity.
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_listing_videos_listing"
  ON listing_videos (listing_id);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_listing_videos_provider"
  ON listing_videos (provider_id);

-- What the 10-minute sweep scans: the ones still claiming to be uploading.
CREATE INDEX IF NOT EXISTS "IDX_listing_videos_pending"
  ON listing_videos (status, updated_at);

COMMIT;
