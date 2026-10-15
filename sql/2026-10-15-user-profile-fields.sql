-- Who a user is, beyond a name and a number: date of birth, gender, address,
-- a bio, and the social accounts they want shown on their profile.
--
-- `birth_date` is a DATE and not an age: an age column is wrong within a year
-- of being written, with no way to correct it but asking everybody again.
-- It is `date` rather than `timestamptz` because a birthday is a calendar day
-- and a zone would move it across the date line.
--
-- All five are nullable. Every account that existed before this migration has
-- none of them, and a NOT NULL birth_date would have to invent one. New
-- registrations are required to give a birth date — enforced by the API, not
-- the column, so the old rows stay readable.
--
-- `social_links` is one jsonb keyed by platform rather than six columns: the
-- set is presentational, so adding or dropping a platform should be a change
-- to one constant and an icon, not a migration. Keys are validated against
-- SOCIAL_PLATFORMS on the way in, so nothing unknown is stored.
--
--   psql "$DATABASE_URL" -f sql/2026-10-15-user-profile-fields.sql

BEGIN;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS birth_date   date,
  ADD COLUMN IF NOT EXISTS gender       character varying(10),
  ADD COLUMN IF NOT EXISTS address      character varying(255),
  ADD COLUMN IF NOT EXISTS bio          text,
  ADD COLUMN IF NOT EXISTS social_links jsonb;

COMMIT;
