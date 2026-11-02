/**
 * Is this database URL pointing at a container on this machine?
 *
 * Lifted out of typeorm.config.ts so the CLI's DataSource and the running
 * application decide TLS the same way. Two copies of this regex would mean a
 * CLI that connects without TLS to a host the app connects to with it, and
 * the symptom — a migration that works locally and hangs on the droplet —
 * would take an afternoon to trace back here.
 */
export const isLocalHost = (url: string): boolean =>
  /@(localhost|127\.0\.0\.1|host\.docker\.internal|postgres)[:/]/.test(url);
