-- Clean slate for media, when the old Bunny storage zone is being thrown away
-- rather than copied.
--
-- Every media URL in this database is absolute: once the old zone is deleted,
-- the rows naming it are links to nothing. Nothing here touches a file — it
-- clears the ROWS that would otherwise render as broken images against the
-- new zone.
--
--   # the safe half: listing photos, avatars, comment photos, map thumbnails
--   psql "$DATABASE_URL" -f sql/2026-10-24-bunny-media-reset.sql
--
--   # also chat attachments, support attachments and KYC documents
--   psql "$DATABASE_URL" -v wipe_attachments=1 -f sql/2026-10-24-bunny-media-reset.sql
--
-- ONLY Bunny-hosted rows are touched. Media from anywhere else survives —
-- which matters more than it sounds: seed-listings.ts fills a fresh database
-- with Unsplash photos, and a reset that took those with it would leave a
-- developer staring at an empty app and wondering what they broke.
-- Override the match to narrow it further, e.g. one specific old zone:
--
--   psql "$DATABASE_URL" -v match_pattern='https://qayoda.b-cdn.net%' -f ...
--
-- The second half is opt-in because chat history and identity documents are
-- the three things nobody expects to disappear. On a development database
-- they are test data; on anything real, copy the files instead — see
-- sql/2026-10-23-bunny-rehost.sql.
--
-- Videos need nothing: `videos` rows store the Bunny Stream GUID and build
-- their URLs at read time, so a new library is an env change only.

\if :{?match_pattern}
\else
\set match_pattern '%b-cdn.net%'
\endif

BEGIN;

-- Listing photos. Deleted rather than nulled: the columns are NOT NULL, and
-- a listing with no photos is a state the app already handles (it shows the
-- placeholder) — re-seed or re-upload afterwards.
DELETE FROM listing_images
 WHERE url LIKE :'match_pattern' OR thumb_url LIKE :'match_pattern';

-- The thumbnail a map pin carries, which is a copy of the listing's primary
-- photo rather than a file of its own.
UPDATE listing_map_points
   SET thumb_url = NULL
 WHERE thumb_url LIKE :'match_pattern';

-- Avatars. Both columns go together: the app falls back to initials, and a
-- full-size avatar with no thumbnail is a half-broken profile row.
UPDATE users
   SET avatar_url = NULL, avatar_thumb_url = NULL
 WHERE avatar_url LIKE :'match_pattern'
    OR avatar_thumb_url LIKE :'match_pattern';

-- The optional photo on a listing comment. The dimensions go too — they only
-- exist so the thread can hold the right space before the photo loads, and a
-- reserved gap for an image that will never arrive is worse than no gap.
UPDATE listing_comments
   SET image_url = NULL, image_thumb_url = NULL,
       image_width = NULL, image_height = NULL
 WHERE image_url LIKE :'match_pattern'
    OR image_thumb_url LIKE :'match_pattern';

\if :{?wipe_attachments}

-- Chat attachments. The bubble renders without a URL (resolveMediaUrl returns
-- undefined and the open handler is guarded), so the message survives as an
-- empty attachment rather than a crash — which is the honest result when the
-- file is genuinely gone.
UPDATE messages
   SET media_url = NULL, thumb_url = NULL
 WHERE media_url LIKE :'match_pattern' OR thumb_url LIKE :'match_pattern';

UPDATE support_messages
   SET image_url = NULL, image_thumb_url = NULL, media_url = NULL
 WHERE image_url LIKE :'match_pattern'
    OR image_thumb_url LIKE :'match_pattern'
    OR media_url LIKE :'match_pattern';

-- Identity documents: the rows go, not just the URLs. A PENDING request whose
-- passport photos no longer exist is a request no moderator can decide, and
-- leaving it in the queue only produces a rejection the applicant did not
-- earn. Deleting it lets them apply again; `users.is_verified_realtor` is a
-- separate column and is not touched, so anyone already approved stays
-- approved.
DELETE FROM verification_requests
 WHERE passport_front_url LIKE :'match_pattern'
    OR passport_back_url LIKE :'match_pattern'
    OR selfie_url LIKE :'match_pattern';

\endif

-- Anything still pointing at a Bunny host. Every count should be 0 — a
-- non-zero one is either a column this file does not know about, or the
-- attachments half that was deliberately skipped.
SELECT 'listing_images' AS source, count(*) FROM listing_images
  WHERE url LIKE '%b-cdn.net%' OR thumb_url LIKE '%b-cdn.net%'
UNION ALL SELECT 'listing_map_points', count(*) FROM listing_map_points
  WHERE thumb_url LIKE '%b-cdn.net%'
UNION ALL SELECT 'users', count(*) FROM users
  WHERE avatar_url LIKE '%b-cdn.net%' OR avatar_thumb_url LIKE '%b-cdn.net%'
UNION ALL SELECT 'listing_comments', count(*) FROM listing_comments
  WHERE image_url LIKE '%b-cdn.net%' OR image_thumb_url LIKE '%b-cdn.net%'
UNION ALL SELECT 'messages (opt-in)', count(*) FROM messages
  WHERE media_url LIKE '%b-cdn.net%' OR thumb_url LIKE '%b-cdn.net%'
UNION ALL SELECT 'support_messages (opt-in)', count(*) FROM support_messages
  WHERE image_url LIKE '%b-cdn.net%' OR image_thumb_url LIKE '%b-cdn.net%'
     OR media_url LIKE '%b-cdn.net%'
UNION ALL SELECT 'verification_requests (opt-in)', count(*) FROM verification_requests
  WHERE passport_front_url LIKE '%b-cdn.net%'
     OR passport_back_url LIKE '%b-cdn.net%'
     OR selfie_url LIKE '%b-cdn.net%';

COMMIT;
