-- Applications for the verified badge.
--
-- The three document columns are nullable on purpose: they hold a CDN URL
-- only while an application is waiting. The moment a moderator approves or
-- rejects one, the columns are cleared and the files are deleted from
-- storage — the decision is worth keeping, the passport photo is not.
--
-- The partial unique index is what stops one account having two applications
-- in the queue, while leaving its earlier decided attempts alone.
--
-- Index and constraint names are TypeORM's own, so `npm run schema:sql`
-- stays silent after this runs.
--
--   psql "$DATABASE_URL" -f sql/2026-09-30-verification.sql

BEGIN;

CREATE TABLE IF NOT EXISTS verification_requests (
  "id"                 uuid NOT NULL DEFAULT uuid_generate_v4(),
  "user_id"            uuid NOT NULL,
  "status"             character varying(20) NOT NULL DEFAULT 'PENDING',
  "passport_front_url" text,
  "passport_back_url"  text,
  "selfie_url"         text,
  "reviewer_id"        uuid,
  "reviewed_at"        TIMESTAMP WITH TIME ZONE,
  "rejection_reason"   text,
  "created_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  CONSTRAINT "PK_c5d405ea25e8abd5b0b096a4f6f" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "IDX_44f76cc6635620daadc8229d7d" ON "verification_requests" ("user_id");
-- The queue reads by status first.
CREATE INDEX IF NOT EXISTS "IDX_61720dd6c6c4a205a5514538de" ON "verification_requests" ("status");
-- One application waiting per account; decided ones do not collide.
CREATE UNIQUE INDEX IF NOT EXISTS "uq_verification_pending" ON "verification_requests" ("user_id") WHERE status = 'PENDING';

COMMIT;
