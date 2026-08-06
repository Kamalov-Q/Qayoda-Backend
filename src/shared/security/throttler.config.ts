import { ThrottlerModuleOptions } from '@nestjs/throttler';
export const throttlerConfig: ThrottlerModuleOptions = [
  { name: 'default', ttl: 60_000, limit: 100 },
];

export const OTP_REQUEST_THROTTLE = { limit: 3, ttl: 60_000 }; // 3 requests per minute
export const LOGIN_THROTTLE = { limit: 5, ttl: 60_000 }; // 5 requests per minute
export const OTP_VERIFY_THROTTLE = { limit: 10, ttl: 60_000 }; // 10 requests per minute
export const REFRESH_THROTTLE = { limit: 20, ttl: 60_000 }; // 20 requests per minute
