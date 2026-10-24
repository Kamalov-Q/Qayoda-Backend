-- Device tokens, so a notification can reach a phone that is not open.
--
-- The inbox works by polling: the bell re-checks every sixty seconds while
-- somebody is looking at the app. That is the wrong mechanism for the things
-- it now carries — a top-up clearing, a buyer messaging about a listing —
-- because all of them happen while the app is closed.
--
--   psql "$DATABASE_URL" -f sql/2026-10-24-push-tokens.sql
--
-- Safe to re-run.

BEGIN;

CREATE TABLE IF NOT EXISTS push_tokens (
  -- The Expo token IS the identity. One row per device, and a device that
  -- reinstalls gets a new token and a new row; the old one stays until Expo
  -- reports it dead, which is the only reliable signal that it is.
  token       text PRIMARY KEY,

  -- Re-pointed, not duplicated, when a second account signs in on one phone:
  -- the token belongs to the device, and the last person to sign in is who
  -- it should reach. Without this a shared phone sends one person's messages
  -- to another person's lock screen.
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  platform    varchar(10) NOT NULL,

  -- Touched on every registration. A token nothing has refreshed in months
  -- belongs to an app that was deleted, and pruning by this is cheaper than
  -- waiting for every send to fail.
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Every send starts "who are this user's devices".
CREATE INDEX IF NOT EXISTS idx_push_tokens_user ON push_tokens (user_id);

COMMIT;
