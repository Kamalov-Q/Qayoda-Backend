-- Payme as a second top-up provider, and fiscal receipts (soliq) for both.
-- Run AFTER 2026-10-05-wallet-click.sql. Idempotent: safe to run twice.
--
--   provider_doc_id        Click's click_paydoc_id — the id its fiscal API takes
--   provider_*_time        Payme's create/perform/cancel times, epoch ms
--   fiscal_*               who sends the receipt and how that went
--
-- Index names match src/modules/billing/entities/payment.entity.ts.

BEGIN;

ALTER TABLE payments ALTER COLUMN provider_txn_id TYPE varchar(64);

ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_doc_id       varchar(64);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_create_time  bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_perform_time bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS provider_cancel_time  bigint;

ALTER TABLE payments ADD COLUMN IF NOT EXISTS fiscal_status   varchar(16) NOT NULL DEFAULT 'NONE';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fiscal_attempts int         NOT NULL DEFAULT 0;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fiscal_response jsonb;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS fiscal_sent_at  timestamptz;

-- GetStatement (Payme) lists transactions by their create time.
CREATE INDEX IF NOT EXISTS "IDX_payments_provider_create_time"
  ON payments (provider, provider_create_time);

COMMIT;
