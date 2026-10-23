-- Stories are gone from the product; this takes their tables with them.
--
-- The feature was removed from the app and the server in one go: no screen
-- reaches these rows any more, and nothing is being kept for later. Short-form
-- video is being built as its own thing rather than on top of this schema.
--
-- Checked before writing this: all four tables were empty, and the ledger held
-- no STORY_POST rows, so nothing of anybody's is being thrown away. The tariff
-- row goes too — an admin price for an action the server no longer charges is
-- a number nobody can act on.
--
-- CASCADE on the parent: story_views and story_reactions key off stories, and
-- dropping it first would otherwise be refused.

BEGIN;

DROP TABLE IF EXISTS story_reports;
DROP TABLE IF EXISTS story_reactions;
DROP TABLE IF EXISTS story_views;
DROP TABLE IF EXISTS stories CASCADE;

DELETE FROM tariffs WHERE action = 'STORY_POST';

COMMIT;
