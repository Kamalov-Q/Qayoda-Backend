import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { SOCIAL_HANDLE_MAX } from '../user-profile.constants';

const clean = ({ value }: { value: unknown }) => {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  // An empty string means "remove it", which the service reads as undefined.
  return trimmed === '' ? undefined : trimmed;
};

const handle = () =>
  function (target: object, key: string) {
    ApiPropertyOptional({
      maxLength: SOCIAL_HANDLE_MAX,
      description: 'Handle or full URL, as the user typed it.',
    })(target, key);
    IsOptional()(target, key);
    IsString()(target, key);
    MaxLength(SOCIAL_HANDLE_MAX)(target, key);
    Transform(clean)(target, key);
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
  @handle() tiktok?: string;
  @handle() instagram?: string;
  @handle() facebook?: string;
  @handle() x?: string;
  @handle() threads?: string;
  @handle() whatsapp?: string;
}
