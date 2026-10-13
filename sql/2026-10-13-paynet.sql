-- Paynet as a third top-up provider (push model: Paynet pays an ACCOUNT).
-- Run AFTER 2026-10-10-payme-fiscal.sql. Idempotent: safe to run twice.
--
--   users.account_no   short public number ("Hisob raqami") the payer gives Paynet
--
-- Index name matches src/modules/users/entities/user.entity.ts.

BEGIN;

CREATE SEQUENCE IF NOT EXISTS users_account_no_seq START 10001;
ALTER TABLE users ADD COLUMN IF NOT EXISTS account_no int;
UPDATE users SET account_no = nextval('users_account_no_seq') WHERE account_no IS NULL;
ALTER TABLE users ALTER COLUMN account_no SET DEFAULT nextval('users_account_no_seq');
ALTER TABLE users ALTER COLUMN account_no SET NOT NULL;
ALTER SEQUENCE users_account_no_seq OWNED BY users.account_no;
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_account_no ON users (account_no);

-- GetStatement (Paynet) lists paid transactions by paid_at.
CREATE INDEX IF NOT EXISTS "IDX_payments_provider_paid_at" ON payments (provider, paid_at);

COMMIT;
