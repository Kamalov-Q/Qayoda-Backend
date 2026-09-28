/**
 * A DataSource for the TypeORM CLI only — the app itself is wired through
 * TypeOrmModule (see shared/database/typeorm.config.ts).
 *
 * It exists for one job: `npm run schema:sql` prints the SQL that would make
 * the database match the entities. With NODE_ENV=production the server never
 * changes the schema itself, so after adding or changing an entity you run
 * that, read the statements, and apply the ones you want by hand.
 *
 * `synchronize` is false here on purpose: the CLI must be able to SHOW the
 * changes without ever being able to APPLY them by accident.
 */
import 'dotenv/config';
import { DataSource } from 'typeorm';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set — run this from the server directory');
}

const isLocalHost = /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)[:/]/.test(url);

export default new DataSource({
  type: 'postgres',
  url,
  ssl: isLocalHost ? false : { rejectUnauthorized: true },
  // Compiled or not, whichever the caller is running.
  //
  // BOTH globs load, and a stale `dist` wins where the two disagree — an
  // entity edited but not rebuilt makes `schema:sql` report drift that does
  // not exist (and miss drift that does). Run `npm run build` before trusting
  // its output, or delete `dist`.
  entities: ['src/**/*.entity.ts', 'dist/**/*.entity.js'],
  synchronize: false,
  logging: false,
});
