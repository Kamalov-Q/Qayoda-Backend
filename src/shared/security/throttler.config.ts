import { ThrottlerModuleOptions } from '@nestjs/throttler';

/**
 * The floor every route sits behind. Auth routes narrow it further with
 * `@Throttle`, and the SMS flow adds per-number limits on top — a per-IP cap
 * alone does nothing against an attacker with a pool of addresses.
 */
export const throttlerConfig: ThrottlerModuleOptions = [
  { name: 'default', ttl: 60_000, limit: 100 },
];
