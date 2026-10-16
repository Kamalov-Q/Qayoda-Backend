-- Manual wallet adjustments: idempotency and a real audit column.
--
--   client_id  the caller's own key for one adjustment. A double-clicked
--              "credit 100 000" sends the same key twice and the unique index
--              refuses the second write, so the money is credited once.
--              Null for everything generated server-side (tariff charges,
--              top-up bonuses) — those have no client to double-send them.
--
--   admin_id   who made the adjustment. This used to live inside `note` as
--              "[admin <uuid>] ...", which made "what has this admin changed"
--              a LIKE over free text that an admin can also type into.
--
-- Index name matches src/modules/billing/entities/wallet-transaction.entity.ts
-- so `npm run schema:sql` stays silent. Idempotent: safe to run twice.
--
--   psql "$DATABASE_URL" -f sql/2026-10-16-wallet-adjust-audit.sql

BEGIN;

ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS client_id uuid,
  ADD COLUMN IF NOT EXISTS admin_id  uuid;

CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_transaction_client"
  ON wallet_transactions (user_id, client_id)
  WHERE client_id IS NOT NULL;

COMMIT;
