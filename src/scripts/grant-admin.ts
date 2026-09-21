/**
 * Promote (or demote) an account by phone number.
 *
 *   npm run admin:grant -- +998901234567
 *   npm run admin:grant -- +998901234567 --revoke
 *
 * There is deliberately no endpoint for this: an API that mints admins is a
 * standing target, and the first admin has to come from somewhere anyway. Run
 * it on the server, where DATABASE_URL already points at the right database.
 */
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppModule } from '../app.module';
import { User } from '../modules/users/entities/user.entity';
import { UserRole } from '../shared/enums';

/**
 * Accepts +998 90 123 45 67, 901234567, 998901234567. The stored form keeps
 * the plus (`+998XXXXXXXXX`) — the same shape loginWithPassword looks up, so
 * this must match it exactly or the account is never found.
 */
function normalize(input: string): string {
  const digits = input.replace(/\D/g, '');
  const local = digits.startsWith('998') ? digits.slice(3) : digits;
  if (local.length !== 9) {
    throw new Error(`Not an Uzbek mobile number: "${input}" (expected 9 digits after 998)`);
  }
  return `+998${local}`;
}

async function main() {
  const [phoneArg, ...flags] = process.argv.slice(2);
  if (!phoneArg) {
    console.error('Usage: npm run admin:grant -- <phone> [--revoke]');
    process.exit(1);
  }
  const revoke = flags.includes('--revoke');
  const phoneNumber = normalize(phoneArg);

  // No HTTP server, no sockets — just the providers, so this can run on a box
  // where the API is already listening on the port.
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  try {
    const users = app.get<Repository<User>>(getRepositoryToken(User));
    const user = await users.findOne({ where: { phoneNumber } });
    if (!user) {
      console.error(`No account with phone ${phoneNumber}. Sign in on the app once first.`);
      process.exitCode = 1;
      return;
    }

    const role = revoke ? UserRole.USER : UserRole.ADMIN;
    if (user.role === role) {
      console.log(`${phoneNumber} is already ${role}. Nothing to do.`);
      return;
    }

    await users.update({ id: user.id }, { role });
    // JwtAccessGuard re-reads the role on every request, so this lands on the
    // next call — no need to sign out and back in.
    console.log(`${phoneNumber} (${user.name ?? 'unnamed'}) is now ${role}.`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
