-- One-off: recompute every stored USD price at the current rate.
--
--   psql "$DATABASE_URL" -v rate=11893.786261 -f sql/2026-10-29-reprice-usd.sql
--
-- `price_usd` is a cached conversion, written once at save time and — until
-- PriceNormalizationService — never recomputed. Production spent its life on
-- the hardcoded 12800 fallback because cbu.uz does not answer foreign IPs,
-- against a real rate near 11900, so every so'm-quoted listing's stored USD
-- figure was about 7.6% low.
--
-- That column is what the app FILTERS and SORTS on — so'm cannot be compared
-- against dollars — so "under $8,000" was returning flats asking well over
-- it, even after the displayed price became correct.
--
-- From here the hourly service keeps this true on its own. This file exists
-- for the step change it cannot see: it only reprices when the rate moves,
-- and the rows were already wrong before it ever ran.
--
-- Pass the rate explicitly rather than hardcoding one, so re-running this in
-- six months cannot silently reprice the database to a stale number:
--
--   RATE=$(curl -s https://open.er-api.com/v6/latest/USD | jq -r .rates.UZS)
--   psql "$DATABASE_URL" -v rate="$RATE" -f sql/2026-10-29-reprice-usd.sql
--
-- Idempotent: IS DISTINCT FROM means a second run at the same rate updates
-- nothing at all.

\if :{?rate}
\else
  \echo '!! Pass the rate:  psql -v rate=11893.78 -f <this file>'
  \echo '!! Nothing was changed.'
  -- \quit takes no exit code; psql warns and ignores one. Stopping here is
  -- the whole job — the danger this guards against is a human repricing the
  -- database to an empty string, not a script needing a status.
  \quit
\endif

BEGIN;

-- ::numeric on both sides is load-bearing. `price / 11893.78` with the
-- literal read as double precision yields double, and ROUND(double, integer)
-- does not exist in Postgres — the statement errors rather than rounding.
--
-- The rounding matches RatesService.toUsd exactly (Math.round of hundredths,
-- round-half-away-from-zero, which is what ROUND does on numeric). If the two
-- disagreed, every row would flip between two values on every reprice.
UPDATE listing_offers
   SET price_usd = ROUND(price / :'rate'::numeric, 2)
 WHERE currency = 'UZS'
   AND price_usd IS DISTINCT FROM ROUND(price / :'rate'::numeric, 2);

-- The map's projection carries its own copy. A map whose price filter
-- disagrees with the list's is worse than either being a little stale, so
-- both move together, in one transaction.
UPDATE listing_map_points
   SET price_usd = ROUND(price / :'rate'::numeric, 2)
 WHERE currency = 'UZS'
   AND price_usd IS DISTINCT FROM ROUND(price / :'rate'::numeric, 2);

-- What changed, before committing. USD rows are untouched by design:
-- price_usd equals price for them and no rate can alter that.
SELECT currency,
       count(*)                     AS rows,
       round(min(price_usd), 2)     AS min_usd,
       round(max(price_usd), 2)     AS max_usd
  FROM listing_offers
 GROUP BY currency ORDER BY currency;

COMMIT;
