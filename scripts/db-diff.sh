#!/usr/bin/env bash
#
# How far has the local database drifted from production?
#
# This is the check to run BEFORE baselining, and it is read-only.
#
# `synchronize` has been on outside production for the life of this project,
# so the local schema is whatever the entities happened to say on each boot.
# Production's schema came from the hand-run files in sql/. Those two have
# been diverging quietly, and nothing has ever compared them.
#
# It matters because the first `db:generate` after baselining writes a
# migration from the difference between the ENTITIES and a database. If the
# entities have drifted, that migration will carry the drift to production —
# and TypeORM implements a column type change as DROP + ADD, so "drift"
# can mean "every value in that column".
#
# Every line of output is something to decide about deliberately.
#
#   PROD_URL=postgres://…  LOCAL_URL=postgres://…  npm run db:diff
#
# Neither URL is written to. It runs pg_dump --schema-only against each.
set -euo pipefail

PROD_URL="${PROD_URL:-}"
LOCAL_URL="${LOCAL_URL:-${DATABASE_URL:-}}"

if [[ -z "$PROD_URL" || -z "$LOCAL_URL" ]]; then
  cat >&2 <<'USAGE'
Usage: PROD_URL=… LOCAL_URL=… npm run db:diff

  PROD_URL   the production database (read only)
  LOCAL_URL  the one to compare against; defaults to DATABASE_URL

Both are dumped with --schema-only. No data is read and nothing is written.
USAGE
  exit 1
fi

out="$(mktemp -d)"
trap 'rm -rf "$out"' EXIT

# --no-owner and --no-privileges: role names differ between a droplet and a
# laptop, and a diff full of ALTER … OWNER TO says nothing about the schema.
dump() {
  pg_dump "$1" --schema-only --no-owner --no-privileges \
    | grep -vE '^(--|SET |SELECT pg_catalog|$)' \
    > "$2"
}

echo "dumping production…"
dump "$PROD_URL"  "$out/prod.sql"
echo "dumping local…"
dump "$LOCAL_URL" "$out/local.sql"

echo
echo "=== tables in one and not the other ==="
tables() { grep -oE '^CREATE TABLE [a-z_."]+' "$1" | awk '{print $3}' | tr -d '"' | sort -u; }
tables "$out/prod.sql"  > "$out/prod.tables"
tables "$out/local.sql" > "$out/local.tables"
comm -23 "$out/prod.tables" "$out/local.tables" | sed 's/^/  prod only : /'
comm -13 "$out/prod.tables" "$out/local.tables" | sed 's/^/  local only: /'

echo
echo "=== full schema diff (prod → local) ==="
# Not `diff -q`: the point is to read it. If it is long, that is the finding.
if diff -u "$out/prod.sql" "$out/local.sql" > "$out/diff.txt"; then
  echo "  identical."
else
  lines=$(wc -l < "$out/diff.txt")
  echo "  $lines lines of difference. First 120:"
  echo
  head -120 "$out/diff.txt" | sed 's/^/  /'
  if (( lines > 120 )); then
    cp "$out/diff.txt" ./schema-drift.diff
    echo
    echo "  …full diff written to ./schema-drift.diff"
  fi
fi
