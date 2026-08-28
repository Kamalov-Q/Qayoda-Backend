import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length } from 'class-validator';

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
}
