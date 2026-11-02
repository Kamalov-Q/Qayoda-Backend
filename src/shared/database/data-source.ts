import 'dotenv/config';
import { DataSource } from 'typeorm';
import { isLocalHost } from './is-local-host';

/**
 * The DataSource the TypeORM **CLI** uses. Nest does not read this file.
 *
 * ── Why a second place that describes the database ─────────────────────────
 *
 * `typeorm.config.ts` builds options for the Nest module, inside the running
 * application, after ConfigModule has loaded `.env`. The CLI has no Nest and
 * no ConfigModule — it is a script run from a terminal — so it needs its own
 * entry point and loads `.env` itself.
 *
 * The connection details that must not drift between the two (the URL and
 * the TLS rule) are shared through `is-local-host.ts` and `DATABASE_URL`.
 * Everything else here is deliberately different, and the differences are
 * the point:
 *
 *   synchronize   ALWAYS false. The CLI exists precisely to replace it. A
 *                 CLI that synchronised would reshape the database behind
 *                 the back of the migration history it is supposed to be
 *                 writing.
 *
 *   migrations    Read from `dist/` when they have been compiled, from
 *                 `src/` when run through ts-node. Generating a migration
 *                 needs the TypeScript; running one in production needs the
 *                 JavaScript.
 *
 * ── How this gets used ─────────────────────────────────────────────────────
 *
 *   npm run db:diff      what production has that the entities do not, and
 *                        the other way round — READ ONLY, run this first
 *   npm run db:generate  write a migration from that difference
 *   npm run db:run       apply pending migrations
 *   npm run db:revert    undo the last one
 *   npm run db:show      what has been applied
 *
 * Point it at a database with `DATABASE_URL=… npm run db:show`. It connects
 * to whatever that variable says, with no safety net — check it before you
 * run anything that writes.
 */

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. The CLI reads it from .env in this directory, ' +
      'or from the environment: DATABASE_URL=… npm run db:show',
  );
}

/** Compiled JS exists only after `npm run build`; the CLI may run either way. */
const compiled = __filename.endsWith('.js');

export const AppDataSource = new DataSource({
  type: 'postgres',
  url,
  // Same rule as typeorm.config.ts: local containers serve no TLS, and
  // TypeORM discards the URL's query string so `?sslmode=require` never
  // reaches the driver on its own.
  ssl: isLocalHost(url) ? false : { rejectUnauthorized: true },
  synchronize: false,
  logging: ['error', 'warn', 'migration'],
  entities: [
    compiled ? 'dist/**/*.entity.js' : 'src/**/*.entity.ts',
  ],
  migrations: [
    compiled ? 'dist/migrations/*.js' : 'src/migrations/*.ts',
  ],
  // The default name, stated so it is greppable: this table is what makes a
  // baseline possible — a row in it means "already applied, do not run".
  migrationsTableName: 'migrations',
});
