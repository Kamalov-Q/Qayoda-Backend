import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/** Eskiz and the DB both want bare digits; typed numbers arrive spaced. */
const stripSeparators = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.replace(/[\s()-]/g, '') : value;

const PHONE = /^(\+?998)?\d{9}$/;
const PHONE_MESSAGE = "Telefon raqami noto'g'ri";

class LocalizedDto {
  @ApiPropertyOptional({
    enum: ['uz', 'ru'],
    description:
      'Device locale, used for the SMS text and as the new account default. ' +
      'A returning user keeps the language stored on their profile.',
  })
  @IsOptional()
  @IsIn(['uz', 'ru'])
  lang?: 'uz' | 'ru';
}

export class RequestOtpDto extends LocalizedDto {
  @ApiProperty({
    example: '+998901234567',
    description: 'Uzbek mobile. `998901234567` and `901234567` also work.',
  })
  @Transform(stripSeparators)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;
}

export class VerifyOtpDto extends LocalizedDto {
  @ApiProperty({ example: '+998901234567' })
  @Transform(stripSeparators)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;

  @ApiProperty({ example: '123456', description: 'The 6 digits from the SMS.' })
  @Matches(/^\d{6}$/)
  code: string;

  @ApiPropertyOptional({
    description: 'Only used when this call creates a new account.',
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name?: string;
}

export class PhoneLoginDto {
  @ApiProperty({ example: '+998901234567' })
  @Transform(stripSeparators)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;

  @ApiProperty({ description: 'The password set after onboarding.' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;
}

export class SetPasswordDto {
  @ApiProperty({ minLength: 6, maxLength: 64 })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;
}

export class ResetPasswordDto {
  @ApiProperty({ example: '+998901234567' })
  @Transform(stripSeparators)
  @Matches(PHONE, { message: PHONE_MESSAGE })
  phone: string;

  @ApiProperty({ example: '123456', description: 'The 6 digits from the SMS.' })
  @Matches(/^\d{6}$/)
  code: string;

  @ApiProperty({ minLength: 6, maxLength: 64, description: 'The new password.' })
  @IsString()
  @MinLength(6)
  @MaxLength(64)
  password: string;
}

export class GoogleSignInDto extends LocalizedDto {
  @ApiProperty({
    description:
      "Google's ID token from the native sign-in SDK — not an access token. " +
      'Verified here against Google’s public keys.',
  })
  @IsString()
  @MinLength(20)
  idToken: string;
}

export class TelegramPollDto {
  @ApiProperty({ description: 'The `token` returned by `POST /auth/telegram/start`.' })
  @IsString()
  @MinLength(10)
  @MaxLength(64)
  token: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'The `refreshToken` from the last session response.' })
  @IsString()
  @MinLength(20)
  refreshToken: string;
}
