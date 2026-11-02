import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { runPreSync } from './pre-sync';
// Shared with the CLI's DataSource — two copies of this rule would mean the
// CLI connecting without TLS to a host the app uses TLS for.
import { isLocalHost } from './is-local-host';

/**
 * Built lazily so `process.env` is read after ConfigModule has loaded `.env`.
 *
 * `ssl` has to be passed explicitly: TypeORM parses `url` into its parts and
 * discards the query string, so `?sslmode=require` never reaches the driver.
 * Local containers don't serve TLS, so it is only enabled for remote hosts.
 */
export const typeOrmConfig = async (): Promise<TypeOrmModuleOptions> => {
  const url = process.env.DATABASE_URL!;
  const ssl = isLocalHost(url) ? false : { rejectUnauthorized: true };

  // Before TypeORM connects: the in-place conversions synchronize would
  // otherwise perform destructively. See pre-sync.ts.
  await runPreSync(url, ssl);

  return {
    type: 'postgres',
    url,
    ssl,
    autoLoadEntities: true,
    /**
     * Off. Everywhere. Migrations are the mechanism now — see MIGRATIONS.md.
     *
     * It was `NODE_ENV !== 'production'`, which sounds cautious and is not.
     * A dev server running with `--watch` reshapes the schema from the
     * entities on every reload, so it does not merely drift from production
     * — it actively UNDOES anything a migration has done that the entities
     * do not yet describe. Writing the organizations migration against a
     * running dev server, it reverted the wallets re-key three times in a
     * row and renamed the primary key back to its own PK_<hash> form.
     *
     * Having two mechanisms is worse than having the worse one: whichever
     * ran last wins, and nothing records which that was.
     *
     * Local setup is now the same as production: `npm run db:run`.
     */
    synchronize: false,
    logging: process.env.NODE_ENV === 'development',
  };
};
