import { TypeOrmModuleOptions } from '@nestjs/typeorm';

const isLocalHost = (url: string) =>
  /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)[:/]/.test(url);

/**
 * Built lazily so `process.env` is read after ConfigModule has loaded `.env`.
 *
 * `ssl` has to be passed explicitly: TypeORM parses `url` into its parts and
 * discards the query string, so `?sslmode=require` never reaches the driver.
 * Local containers don't serve TLS, so it is only enabled for remote hosts.
 */
export const typeOrmConfig = (): TypeOrmModuleOptions => {
  const url = process.env.DATABASE_URL!;

  return {
    type: 'postgres',
    url,
    ssl: isLocalHost(url) ? false : { rejectUnauthorized: true },
    autoLoadEntities: true,
    // Convenient locally, destructive anywhere real: it will happily drop a
    // column whose entity field was renamed. Production needs migrations.
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
  };
};
