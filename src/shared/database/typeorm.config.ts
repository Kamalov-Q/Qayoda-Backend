import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { runPreSync } from './pre-sync';

const isLocalHost = (url: string) =>
  /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)[:/]/.test(url);

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
    // Convenient locally, destructive anywhere real: it will happily drop a
    // column whose entity field was renamed. Production needs migrations.
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
  };
};
