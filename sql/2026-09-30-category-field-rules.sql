-- Two more questions the admin can switch off per category, beside the floor
-- rule that was already there: "new build or resale" and "state of repair".
--
-- Neither makes sense for land — a plot is not a new build and has no repair
-- to describe — and asking anyway gives the seller a question with no right
-- answer. The defaults below mirror that: everything with walls is asked,
-- LAND is not.
--
-- `synchronize` is off in production, so this is the hand-applied version of
-- what it would have created. Safe to re-run.
--
--   psql "$DATABASE_URL" -f sql/2026-09-30-category-field-rules.sql

BEGIN;

ALTER TABLE categories
  ADD COLUMN IF NOT EXISTS building_type_capable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS repair_type_capable   boolean NOT NULL DEFAULT false;

-- Everything that is a building, or stands on one, asks both. Land asks
-- neither. Only run over categories still at the column default, so an admin
-- who has already set these by hand is not overruled by a re-run.
UPDATE categories
   SET building_type_capable = true,
       repair_type_capable   = true
 WHERE slug <> 'LAND'
   AND building_type_capable = false
   AND repair_type_capable   = false;

-- Whatever is switched off must not leave answers behind contradicting it —
-- the same clean-up the service does when an admin turns a flag off.
UPDATE listings l
   SET building_type = NULL
  FROM categories c
 WHERE c.slug = l.category
   AND c.building_type_capable = false
   AND l.building_type IS NOT NULL;

UPDATE listings l
   SET repair_type = NULL
  FROM categories c
 WHERE c.slug = l.category
   AND c.repair_type_capable = false
   AND l.repair_type IS NOT NULL;

COMMIT;
