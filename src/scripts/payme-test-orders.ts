/**
 * Mint a few open Payme orders and print what the provider needs to test them.
 *
 *   npm run payme:orders -- +998901234567
 *   npm run payme:orders -- +998901234567 1000 5000 25000
 *
 * Payme asks for "2-3 ta payment_id va amount" before they will certify a
 * kassa: they call CheckPerformTransaction / CreateTransaction against our
 * endpoint with those values, so each one has to be a real row sitting in
 * CREATED. Making them by hand through the app means opening a checkout that
 * cannot complete yet, three times; this does the same thing through the same
 * service and prints the table to paste back to them.
 *
 * It goes through TopupService rather than inserting rows, so the orders are
 * ordinary ones — same validation, same prepare_id sequence, same cleanup by
 * the stale-payment cron. Which also sets the deadline: an untouched order is
 * cancelled after PAYMENT_TTL_HOURS, and Payme would then see -31051 instead
 * of a payable order, so send these the same day you make them.
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { TopupService } from '../modules/billing/topup.service';
import {
  PAYMENT_TTL_HOURS,
  PaymentProviderKind,
  TOPUP_MAX,
  TOPUP_MIN,
  toTiyin,
} from '../modules/billing/billing.constants';

/** Matches grant-admin's normaliser: the stored form keeps the plus. */
function normalize(input: string): string {
  const digits = input.replace(/\D/g, '');
  const local = digits.startsWith('998') ? digits.slice(3) : digits;
  if (local.length !== 9) {
    throw new Error(`Not an Uzbek mobile number: "${input}" (expected 9 digits after 998)`);
  }
  return `+998${local}`;
}

const DEFAULT_AMOUNTS = [1_000, 5_000, 25_000];

async function main() {
  const [phoneArg, ...rest] = process.argv.slice(2);
  if (!phoneArg) {
    console.error('Usage: npm run payme:orders -- <phone> [amount ...]');
    process.exit(1);
  }
  const phoneNumber = normalize(phoneArg);

  const amounts = rest.length ? rest.map(Number) : DEFAULT_AMOUNTS;
  for (const a of amounts) {
    if (!Number.isFinite(a) || a < TOPUP_MIN || a > TOPUP_MAX) {
      throw new Error(`Amount must be ${TOPUP_MIN}..${TOPUP_MAX} so'm, got "${a}"`);
    }
  }

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const config = app.get(ConfigService);
    if (!config.get('PAYME_MERCHANT_ID') || !config.get('PAYME_KEY')) {
      console.error('PAYME_MERCHANT_ID / PAYME_KEY are not set — Payme is not enabled on this server.');
      process.exitCode = 1;
      return;
    }

    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const user = await users.findOne({ where: { phoneNumber } });
    if (!user) {
      console.error(`No account with phone ${phoneNumber}. Sign in on the app once first.`);
      process.exitCode = 1;
      return;
    }

    const topup = app.get(TopupService);
    const rows: { amount: number; paymentId: string; payUrl: string }[] = [];
    for (const amount of amounts) {
      // No clientId: each run is meant to produce fresh orders, and reusing a
      // key would hand back the previous one instead.
      const order = await topup.createTopup(user.id, amount, PaymentProviderKind.PAYME);
      rows.push({ amount, paymentId: order.paymentId, payUrl: order.payUrl });
    }

    console.log(`\nPayme test orders for ${phoneNumber} (${user.name ?? 'unnamed'})`);
    console.log(`Valid for ${PAYMENT_TTL_HOURS}h — after that the stale-payment cron cancels them.\n`);
    console.log('payment_id                             amount (so\'m)   amount (tiyin)');
    console.log('-'.repeat(74));
    for (const r of rows) {
      console.log(
        `${r.paymentId}   ${String(r.amount).padStart(10)}   ${String(toTiyin(r.amount)).padStart(12)}`,
      );
    }
    console.log('\nPayme sends the TIYIN figure as `amount`; a mismatch is -31001.\n');
    console.log('Checkout links (to try one yourself):');
    for (const r of rows) console.log(`  ${r.amount} so'm  ${r.payUrl}`);
    console.log();
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
