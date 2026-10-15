import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import {
  SOCIAL_HANDLE_MAX,
  normalizeSocialHandle,
  type SocialPlatform,
} from '../user-profile.constants';

/**
 * Canonicalise on the way in: a handle, an @handle, a pasted link or a
 * scheme-less one all collapse to the same bare handle. Whatever is left
 * empty — '', or a WhatsApp entry with no digits in it — means "remove it",
 * which the service reads as undefined.
 */
const clean = (platform: SocialPlatform) =>
  ({ value }: { value: unknown }) => {
    if (typeof value !== 'string') return value;
    const handle = normalizeSocialHandle(platform, value);
    return handle === '' ? undefined : handle;
  };

const handle = (platform: SocialPlatform) =>
  function (target: object, key: string) {
    ApiPropertyOptional({
      maxLength: SOCIAL_HANDLE_MAX,
      description:
        'Handle, @handle or full profile URL. Stored as a bare handle (digits for WhatsApp).',
    })(target, key);
    IsOptional()(target, key);
    IsString()(target, key);
    MaxLength(SOCIAL_HANDLE_MAX)(target, key);
    Transform(clean(platform))(target, key);
  };

/**
 * The six accounts a profile can advertise.
 *
 * A class with one field per platform rather than a free-form record, because
 * the global ValidationPipe runs with `forbidNonWhitelisted` — an unknown key
 * is rejected rather than quietly stored, which is the whole point of having
 * a fixed set. Adding a platform is one field here, one constant, one icon.
 *
 * Each value is kept as typed. A handle and a full URL are both useful and
 * both common, and deciding which one somebody meant is the app's job at
 * render time, not the database's at write time.
 */
export class SocialLinksDto {
  @handle('tiktok') tiktok?: string;
  @handle('instagram') instagram?: string;
  @handle('facebook') facebook?: string;
  @handle('x') x?: string;
  @handle('threads') threads?: string;
  @handle('whatsapp') whatsapp?: string;
}
