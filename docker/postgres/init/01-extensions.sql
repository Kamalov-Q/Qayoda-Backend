-- The User and VerificationToken entities declare `email` as citext,
-- so the extension has to exist before TypeORM synchronises the schema.
CREATE EXTENSION IF NOT EXISTS citext;

-- Listing.geom/centroid are `geography` columns, which PostGIS provides.
CREATE EXTENSION IF NOT EXISTS postgis;
