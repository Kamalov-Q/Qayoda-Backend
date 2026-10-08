-- Wallet + pay-as-you-go + provider top-ups (Click first) with bonus tiers.
-- Prod runs with synchronize OFF, so this file is the schema there.
-- Idempotent: safe to run twice.
--
-- Nothing is seeded: tariffs and bonus tiers are created by an admin from
-- the dashboard. Until a tariff exists for an action, that action is free
-- (and TOP placement is simply not on sale).
--
-- Index and constraint names match the entities in src/modules/billing.

BEGIN;

CREATE TABLE IF NOT EXISTS wallets (
  user_id    uuid PRIMARY KEY,
  balance    numeric(14,2) NOT NULL DEFAULT 0 CHECK (balance >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL,
  amount        numeric(14,2) NOT NULL,
  kind          varchar(32) NOT NULL,
  reference_id  uuid,
  balance_after numeric(14,2) NOT NULL,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_wallet_transaction_user_created"
  ON wallet_transactions (user_id, created_at);
-- One TOPUP and one TOPUP_BONUS row per payment, whatever the code does.
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_wallet_transaction_topup_once"
  ON wallet_transactions (reference_id, kind)
  WHERE kind IN ('TOPUP', 'TOPUP_BONUS');

CREATE TABLE IF NOT EXISTS payments (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          uuid NOT NULL,
  client_id        uuid,
  provider         varchar(16) NOT NULL,
  amount           numeric(14,2) NOT NULL,
  bonus_amount     numeric(14,2) NOT NULL DEFAULT 0,
  status           varchar(16) NOT NULL DEFAULT 'CREATED',
  prepare_id       serial NOT NULL,
  provider_txn_id  varchar(32),
  provider_payload jsonb,
  provider_error   varchar(32),
  paid_at          timestamptz,
  cancelled_at     timestamptz,
  cancel_reason    varchar(64),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_payments_user_created"
  ON payments (user_id, created_at);
CREATE INDEX IF NOT EXISTS "IDX_payments_status_created"
  ON payments (status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payments_prepare_id"
  ON payments (prepare_id);
-- The app's idempotency key: one order per (user, clientId).
ALTER TABLE payments ADD COLUMN IF NOT EXISTS client_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payments_user_client"
  ON payments (user_id, client_id) WHERE client_id IS NOT NULL;
-- One provider transaction can never settle two orders.
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_payments_provider_txn"
  ON payments (provider, provider_txn_id) WHERE provider_txn_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider        varchar(16) NOT NULL,
  action          varchar(32),
  body            jsonb NOT NULL,
  signature_valid boolean NOT NULL,
  response        jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "IDX_payment_webhook_events_created"
  ON payment_webhook_events (created_at);

CREATE TABLE IF NOT EXISTS tariffs (
  id            uuid NOT NULL DEFAULT uuid_generate_v4(),
  action        varchar(40) NOT NULL,
  name_uz       varchar(120) NOT NULL,
  name_ru       varchar(120) NOT NULL,
  price         numeric(14,2) NOT NULL DEFAULT 0,
  duration_days int,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tariffs" PRIMARY KEY (id)
);

CREATE TABLE IF NOT EXISTS topup_bonus_tiers (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  min_amount numeric(14,2) NOT NULL,
  percent    int NOT NULL CHECK (percent BETWEEN 0 AND 100),
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_topup_bonus_tiers_min_amount" UNIQUE (min_amount)
);

-- Upgrade path for a database that ran the first version of this file:
-- widen in place (never DROP + ADD), and shed the columns the entities no
-- longer declare. The old click_payments table is left alone on purpose —
-- it may hold real top-ups; drop it by hand once you have checked.
ALTER TABLE tariffs ALTER COLUMN name_uz TYPE varchar(120);
ALTER TABLE tariffs ALTER COLUMN name_ru TYPE varchar(120);
ALTER TABLE tariffs ALTER COLUMN price SET DEFAULT 0;
ALTER TABLE topup_bonus_tiers DROP COLUMN IF EXISTS updated_at;
ALTER TABLE wallet_transactions ALTER COLUMN kind TYPE varchar(32);
DROP INDEX IF EXISTS idx_wallet_tx_user;

-- How long a tariff's paid effect lasts; null for one-off actions.
ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS duration_days int;

-- Tariffs became admin-created rows: a uuid id, and the old fixed `key` is
-- now the `action` the row prices. Converted in place, keeping every row.
DO $$
DECLARE pk text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'tariffs' AND column_name = 'key'
  ) THEN
    UPDATE tariffs SET duration_days = 7
     WHERE key = 'LISTING_PROMOTE' AND duration_days IS NULL;
    SELECT conname INTO pk FROM pg_constraint
     WHERE conrelid = 'tariffs'::regclass AND contype = 'p';
    IF pk IS NOT NULL THEN
      EXECUTE format('ALTER TABLE tariffs DROP CONSTRAINT %I', pk);
    END IF;
    ALTER TABLE tariffs RENAME COLUMN key TO action;
    ALTER TABLE tariffs ADD COLUMN id uuid NOT NULL DEFAULT uuid_generate_v4();
    ALTER TABLE tariffs ADD CONSTRAINT "PK_tariffs" PRIMARY KEY (id);
    ALTER TABLE tariffs ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;

-- One tariff per one-off action; one per duration of a timed action.
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tariffs_one_off"
  ON tariffs (action) WHERE duration_days IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "IDX_tariffs_timed"
  ON tariffs (action, duration_days) WHERE duration_days IS NOT NULL;

-- Paid "TOP" placement; the feed ranks unexpired promotions first.
ALTER TABLE listings ADD COLUMN IF NOT EXISTS promoted_until timestamptz;

COMMIT;
