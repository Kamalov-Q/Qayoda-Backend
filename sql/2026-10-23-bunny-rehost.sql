-- Move every stored media URL from one Bunny pull zone to another.
--
-- Media URLs are stored ABSOLUTE (the app's resolveMediaUrl passes anything
-- with a scheme straight through), so changing BUNNY_CDN_URL alone points the
-- server at a new zone while every row still names the old one. This rewrites
-- the rows; copy the FILES across first, or the links will be valid and empty.
--
--   psql "$DATABASE_URL" \
--     -v old_cdn='https://qayoda.b-cdn.net' \
--     -v new_cdn='https://growen-media.b-cdn.net' \
--     -f sql/2026-10-23-bunny-rehost.sql
--
-- Both values are the pull-zone origin with no trailing slash — exactly what
-- BUNNY_CDN_URL holds before and after. Safe to re-run: a second pass finds
-- nothing left matching the old host. Wrapped in one transaction, so a typo
-- in a table name leaves the database untouched rather than half-moved.
--
-- Not covered, on purpose: `videos` rows carry no URLs at all (they are built
-- from the Bunny Stream video GUID at read time), so a Stream library change
-- is an env change only.

BEGIN;

-- Listing photos, and the thumbnail the map pin carries.
UPDATE listing_images
   SET url       = replace(url,       :'old_cdn', :'new_cdn'),
       thumb_url = replace(thumb_url, :'old_cdn', :'new_cdn')
 WHERE url LIKE :'old_cdn' || '%' OR thumb_url LIKE :'old_cdn' || '%';

UPDATE listing_map_points
   SET thumb_url = replace(thumb_url, :'old_cdn', :'new_cdn')
 WHERE thumb_url LIKE :'old_cdn' || '%';

-- Avatars.
UPDATE users
   SET avatar_url       = replace(avatar_url,       :'old_cdn', :'new_cdn'),
       avatar_thumb_url = replace(avatar_thumb_url, :'old_cdn', :'new_cdn')
 WHERE avatar_url LIKE :'old_cdn' || '%'
    OR avatar_thumb_url LIKE :'old_cdn' || '%';

-- The photo a listing comment can carry.
UPDATE listing_comments
   SET image_url       = replace(image_url,       :'old_cdn', :'new_cdn'),
       image_thumb_url = replace(image_thumb_url, :'old_cdn', :'new_cdn')
 WHERE image_url LIKE :'old_cdn' || '%'
    OR image_thumb_url LIKE :'old_cdn' || '%';

-- Chat attachments: images keep their own pair, everything else (voice,
-- video, files) hangs off media_url.
UPDATE messages
   SET media_url = replace(media_url, :'old_cdn', :'new_cdn'),
       thumb_url = replace(thumb_url, :'old_cdn', :'new_cdn')
 WHERE media_url LIKE :'old_cdn' || '%' OR thumb_url LIKE :'old_cdn' || '%';

-- Support threads and their replies.
UPDATE support_messages
   SET image_url       = replace(image_url,       :'old_cdn', :'new_cdn'),
       image_thumb_url = replace(image_thumb_url, :'old_cdn', :'new_cdn'),
       media_url       = replace(media_url,       :'old_cdn', :'new_cdn')
 WHERE image_url LIKE :'old_cdn' || '%'
    OR image_thumb_url LIKE :'old_cdn' || '%'
    OR media_url LIKE :'old_cdn' || '%';

-- Identity documents. These live under their own kyc/ prefix and are the one
-- set worth checking by hand after the copy: they are the files whose loss
-- would mean asking people for their passport a second time.
UPDATE verification_requests
   SET passport_front_url = replace(passport_front_url, :'old_cdn', :'new_cdn'),
       passport_back_url  = replace(passport_back_url,  :'old_cdn', :'new_cdn'),
       selfie_url         = replace(selfie_url,         :'old_cdn', :'new_cdn')
 WHERE passport_front_url LIKE :'old_cdn' || '%'
    OR passport_back_url LIKE :'old_cdn' || '%'
    OR selfie_url LIKE :'old_cdn' || '%';

-- What is left pointing at the old host. Expect every count to be 0; anything
-- else is a column this file does not know about yet.
SELECT 'listing_images' AS table, count(*) FROM listing_images
  WHERE url LIKE :'old_cdn' || '%' OR thumb_url LIKE :'old_cdn' || '%'
UNION ALL SELECT 'listing_map_points', count(*) FROM listing_map_points
  WHERE thumb_url LIKE :'old_cdn' || '%'
UNION ALL SELECT 'users', count(*) FROM users
  WHERE avatar_url LIKE :'old_cdn' || '%' OR avatar_thumb_url LIKE :'old_cdn' || '%'
UNION ALL SELECT 'listing_comments', count(*) FROM listing_comments
  WHERE image_url LIKE :'old_cdn' || '%' OR image_thumb_url LIKE :'old_cdn' || '%'
UNION ALL SELECT 'messages', count(*) FROM messages
  WHERE media_url LIKE :'old_cdn' || '%' OR thumb_url LIKE :'old_cdn' || '%'
UNION ALL SELECT 'support_messages', count(*) FROM support_messages
  WHERE image_url LIKE :'old_cdn' || '%' OR image_thumb_url LIKE :'old_cdn' || '%'
     OR media_url LIKE :'old_cdn' || '%'
UNION ALL SELECT 'verification_requests', count(*) FROM verification_requests
  WHERE passport_front_url LIKE :'old_cdn' || '%'
     OR passport_back_url LIKE :'old_cdn' || '%'
     OR selfie_url LIKE :'old_cdn' || '%';

COMMIT;
