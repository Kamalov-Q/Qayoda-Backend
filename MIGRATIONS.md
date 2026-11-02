# Database migrations

Until now the schema was changed two ways: `synchronize` outside production,
and the hand-run files in `sql/`. Neither leaves a record of what was applied
or any way to undo it, and `synchronize` implements a column type change as
DROP + ADD — which on a live table means losing every value in that column.

That was survivable while the schema changes were additive. It is not
survivable for the wallet re-key, which changes the primary key of the table
holding people's money.

## Before anything else: a backup you have restored

A dump you have never restored is a file, not a backup.

```bash
set -a && . ./.env && set +a
pg_dump "$DATABASE_URL" -Fc -f ~/backup-$(date +%F-%H%M).dump

# then prove it:
createdb scratch && pg_restore -d scratch ~/backup-*.dump
psql scratch -c 'select count(*) from users'
```

Nightly, off the droplet, is the minimum before any migration runs against
production. A backup on the same disk as the database protects you from
`DROP TABLE`, not from the disk.

## The commands

```
npm run db:diff       what production has that local does not — READ ONLY
npm run db:baseline   mark the existing schema as migrated — writes one row
npm run db:show       which migrations have been applied
npm run db:generate   write a migration from entities ↔ database difference
npm run db:run        apply pending migrations
npm run db:revert     undo the last one
```

All of them connect to `DATABASE_URL`. There is no safety net on that: check
which database you are pointed at before running anything that writes.
`db:baseline` prints the database name, host and row counts for that reason.

## Setting it up on a database that already exists

Once, in this order.

### 1. Measure the drift — before changing anything

```bash
PROD_URL='postgres://…prod…' LOCAL_URL='postgres://…local…' npm run db:diff
```

This is the step that matters most and the one it is tempting to skip.

`synchronize` has been reshaping the local schema from the entities on every
boot, for months. Production's schema came from `sql/`. Nobody has ever
compared them.

Every line of that diff is a change one database has and the other does not.
The first `db:generate` after baselining writes a migration from the
difference between the **entities** and a database — so any drift in the
entities becomes a migration that runs against production. A diff with
`DROP COLUMN` in it is a data loss waiting for a deploy.

Read it. Decide about each line deliberately. Then continue.

### 2. Baseline production

```bash
DATABASE_URL='postgres://…prod…' npm run db:baseline          # report only
DATABASE_URL='postgres://…prod…' npm run db:baseline -- --write
```

This inserts one row into `migrations` and changes no schema. It says
"everything up to here already happened" — see
`src/migrations/1762100000000-Baseline.ts` for why that claim is the honest
one for this database.

It refuses if migration history already exists, because then the baseline is
not the first thing that happened and something needs explaining first.

### 3. Turn `synchronize` off

In `typeorm.config.ts`, `synchronize` is `NODE_ENV !== 'production'`. Once
migrations are the mechanism, set it to `false` everywhere and run
`npm run db:run` locally like everywhere else. Keeping it on locally is what
produced the drift in step 1, and it will produce it again.

## Day to day

```bash
# 1. change an entity
# 2. generate the migration
npm run db:generate -- src/migrations/AddOrganizations

# 3. READ IT. Every line.
#    Look for DROP COLUMN, DROP TABLE, and type changes — TypeORM writes
#    those as DROP + ADD, which discards the data.
# 4. run it locally, check the result, commit the file
npm run db:run
```

A generated migration is a draft. It is written by comparing two schemas,
which means it cannot tell a rename from a drop-and-add: renaming
`users.phone` to `users.phone_number` generates `DROP COLUMN phone` +
`ADD COLUMN phone_number`, and every number is gone. Rewrite those by hand as
`ALTER TABLE … RENAME COLUMN`.

## Deploying

```bash
git pull && npm ci && npm run build
npm run db:run          # before restarting, not after
pm2 reload uynest-api
```

Migrations run **before** the new code starts. The reverse order means the
new code briefly queries columns that do not exist yet.

For a migration that cannot be undone — the wallet re-key is one — take a
fresh backup immediately before, not last night's.

## `sql/` and `pre-sync.ts`

The files in `sql/` are history now. They are what built production; leave
them for the record and add nothing new there.

`pre-sync.ts` is the other thing to know about: it mutates the schema on
every boot, before TypeORM connects, to do conversions `synchronize` would
otherwise do destructively. It is effectively a migration that is not in the
migration table. Fold its steps into real migrations when convenient — until
then, anyone reading the migration history is not seeing the whole picture.
