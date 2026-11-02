-- Make "log out" actually log out.
--
--   psql "$DATABASE_URL" -f sql/2026-10-29-token-revocation.sql
--
-- An access token is a signed claim that nobody looks up — that is what makes
-- it fast. It also meant logging out, which revokes REFRESH tokens, left the
-- access token already in the client's memory working for up to its full 15
-- minutes. On a shared computer, "log out" did not log you out.
--
-- A denylist of issued tokens is the other way to fix this and costs a lookup
-- on every single request. This costs nothing: JwtAccessGuard already reads
-- this row for status, role and deleted_at behind a 30-second cache, so the
-- comparison rides along on a query that was happening anyway.
--
-- The guard rejects any token whose `iat` predates this column. NULL — the
-- normal state — skips the check entirely, which is also why shipping this
-- does not sign out everybody who is currently signed in: their tokens simply
-- have nothing to be compared against.
--
-- Set by POST /auth/logout, by ban, and by account deletion.
--
-- Idempotent. Declared on the User entity too, as it must be: `synchronize`
-- is on outside production and drops columns the entities do not know about.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tokens_valid_from timestamptz;
