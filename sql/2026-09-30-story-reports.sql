-- Reported stories: the moderators' queue for them.
--
-- The story's own contents are copied onto the report. A story expires,
-- often within hours and sometimes before anybody has looked at the queue,
-- and "story 3f2c was offensive" is a complaint nobody can act on. This is
-- the one table here that denormalises deliberately against its source
-- disappearing — and it is why taking a story down does not take its reports
-- with it.
--
-- Index and constraint names are TypeORM's own, so `npm run schema:sql`
-- stays silent after this runs.
--
--   psql "$DATABASE_URL" -f sql/2026-09-30-story-reports.sql

BEGIN;

CREATE TABLE IF NOT EXISTS story_reports (
  "id"              uuid NOT NULL DEFAULT uuid_generate_v4(),
  "story_id"        uuid NOT NULL,
  "reporter_id"     uuid NOT NULL,
  "author_id"       uuid NOT NULL,
  "reason"          character varying(40) NOT NULL,
  "comment"         text,
  "story_type"      character varying(12) NOT NULL,
  "story_media_url" text,
  "story_thumb_url" text,
  "story_body"      text,
  "status"          character varying(20) NOT NULL DEFAULT 'OPEN',
  "created_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at"      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "uq_story_report_story_reporter" UNIQUE ("story_id", "reporter_id"),
  CONSTRAINT "PK_a827a4f6f8ebb67899e99c584f0" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_f02a50f86ff9b255d1b658a6b3" ON "story_reports" ("story_id");
CREATE INDEX IF NOT EXISTS "IDX_573fec87748e3bb712de13c70f" ON "story_reports" ("reporter_id");
CREATE INDEX IF NOT EXISTS "IDX_fbd8e611452d391b0be4d4d59f" ON "story_reports" ("author_id");
-- The queue reads by status first.
CREATE INDEX IF NOT EXISTS "IDX_aec75daddbb6168fa6e6fbb068" ON "story_reports" ("status");

COMMIT;
