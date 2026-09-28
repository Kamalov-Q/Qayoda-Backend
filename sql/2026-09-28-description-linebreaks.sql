-- Rebuild description_text so it keeps its line breaks.
--
-- The old stripHtml() turned every tag into a space and then collapsed all
-- whitespace, flattening a laid-out advert — bullets, blank lines and all —
-- into one run-on paragraph. The HTML was never damaged, so the plain-text
-- copy can simply be rebuilt from it.
--
--   psql "$DATABASE_URL" -f sql/2026-09-28-description-linebreaks.sql

BEGIN;

UPDATE listings
   SET description_text =
       btrim(
         regexp_replace(
           regexp_replace(
             regexp_replace(
               -- <br> and block closers become newlines…
               regexp_replace(description_html, '<\s*br\s*/?>', E'\n', 'gi'),
               '</\s*(p|div|li|h[1-6])\s*>', E'\n', 'gi'
             ),
             -- …every other tag disappears…
             '<[^>]*>', '', 'g'
           ),
           -- …and three or more blank lines collapse to one gap.
           E'\n{3,}', E'\n\n', 'g'
         )
       )
 WHERE description_html IS NOT NULL
   AND description_html <> '';

COMMIT;
