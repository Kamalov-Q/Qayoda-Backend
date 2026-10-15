import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsRealisticBirthDate } from '../validators/birth-date.validator';
import { SocialLinksDto } from './social-links.dto';
import {
  BIO_MAX,
  GENDERS,
  type Gender,
} from '../user-profile.constants';
import { UZ_PLACE_CODES } from '../uzbekistan';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/**
 * Phone and email are deliberately absent. They are only ever written by the
 * provider that verified them, because a verified contact detail is what
 * auto-linking matches a sign-in against — letting a user type one in would
 * let them claim someone else's account.
 */
export class UpdateProfileDto {
  @ApiPropertyOptional({ example: 'Ada' })
  @IsOptional()
  @IsString()
  @Length(2, 64, { message: 'Name must be between 2 and 64 characters' })
  @Transform(trim)
  name?: string;

  @ApiPropertyOptional({ example: 'Lovelace' })
  @IsOptional()
  @IsString()
  @Length(2, 64, { message: 'Surname must be between 2 and 64 characters' })
  @Transform(trim)
  surname?: string;

  /**
   * ISO date, e.g. `1998-04-23`.
   *
   * Optional here, and required by the onboarding form instead. This is a
   * PATCH: somebody editing only their bio must not be forced to resend a
   * birth date, and every account that predates the column has none to
   * resend. The app asks for it once, at registration.
   */
  @ApiPropertyOptional({ example: '1998-04-23', format: 'date' })
  @IsOptional()
  @IsDateString({ strict: true }, { message: 'Birth date must be YYYY-MM-DD' })
  @IsRealisticBirthDate()
  birthDate?: string;

  /** `null` clears it — these are optional answers somebody may take back. */
  @ApiPropertyOptional({ enum: GENDERS, nullable: true })
  @IsOptional()
  @IsIn(GENDERS)
  gender?: Gender | null;

  /**
   * A SOATO code, not a typed address.
   *
   * Either a region (`1726`) or a district within one (`1726269`) — a
   * district's code nests under its region's, so one value says both.
   * Validated against the list so the column cannot fill up with spellings
   * of the same place: "Toshkent", "Tashkent" and "toshkent shahri" are
   * three values somebody has to reconcile by hand forever otherwise.
   */
  @ApiPropertyOptional({
    description:
      'A region or district SOATO code from GET /regions. `null` clears it.',
    example: '1726269',
  })
  @IsOptional()
  @IsIn(UZ_PLACE_CODES, { message: 'Unknown region or district' })
  address?: string | null;

  @ApiPropertyOptional({ maxLength: BIO_MAX })
  @IsOptional()
  @IsString()
  @MaxLength(BIO_MAX)
  @Transform(trim)
  bio?: string | null;

  @ApiPropertyOptional({ type: SocialLinksDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SocialLinksDto)
  socialLinks?: SocialLinksDto;
}
