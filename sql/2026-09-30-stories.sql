-- Stories: public, short-lived posts on the Home screen.
--
-- A photo, a video, or words on a colour, with an optional caption on any of
-- them and an optional listing of the poster's to send viewers to. Everyone
-- may post, everyone may watch, and each one dies at `expires_at` — 6, 12, 24
-- or 48 hours after it went up, whichever the poster chose.
--
-- Nothing sweeps them: every read filters on `expires_at`, so an expired
-- story is gone the moment it expires whether or not its row has been
-- collected. StoriesService.purgeExpired() clears the rows when you want the
-- space back.
--
-- Index and constraint names are TypeORM's own, so `npm run schema:sql` stays
-- silent after this runs.
--
--   psql "$DATABASE_URL" -f sql/2026-09-30-stories.sql

BEGIN;

CREATE TABLE IF NOT EXISTS stories (
  "id"             uuid NOT NULL DEFAULT uuid_generate_v4(),
  "author_id"      uuid NOT NULL,
  "type"           character varying(12) NOT NULL,
  "media_url"      text,
  "thumb_url"      text,
  "width"          integer,
  "height"         integer,
  "duration_sec"   real,
  "body"           text,
  "background"     integer NOT NULL DEFAULT '0',
  "listing_id"     uuid,
  "view_count"     integer NOT NULL DEFAULT '0',
  "reaction_count" integer NOT NULL DEFAULT '0',
  "expires_at"     TIMESTAMP WITH TIME ZONE NOT NULL,
  "created_at"     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_bb6f880b260ed96c452b32a39f0" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_1e6ca6b1e366a7575873f2d1c3" ON "stories" ("author_id");
CREATE INDEX IF NOT EXISTS "IDX_0419b63e879ffa56ebad115068" ON "stories" ("listing_id");
-- Every read starts "what is still up", so this is the one that matters.
CREATE INDEX IF NOT EXISTS "IDX_b268ef13743e47999b36cb1470" ON "stories" ("expires_at");

CREATE TABLE IF NOT EXISTS story_views (
  "story_id"   uuid NOT NULL,
  "viewer_id"  uuid NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_40f618e81a39f0f3dfa98cc10c2" PRIMARY KEY ("story_id", "viewer_id")
);

CREATE TABLE IF NOT EXISTS story_reactions (
  "story_id"   uuid NOT NULL,
  "user_id"    uuid NOT NULL,
  "emoji"      character varying(16) NOT NULL,
  "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  -- The primary key is the uniqueness rule; a separate unique constraint
  -- over the same two columns would be a second index for nothing.
  CONSTRAINT "PK_496ffe78effd3d115fc9fded40c" PRIMARY KEY ("story_id", "user_id")
);

COMMIT;
