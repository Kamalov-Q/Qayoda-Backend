import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'passw0rd',
    format: 'password',
    description:
      'Ignored for accounts that have no password set yet (e.g. OTP-only sign-ups).',
  })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    example: 'n3wpassw0rd',
    format: 'password',
    minLength: 3,
    maxLength: 32,
    pattern: '^(?=.*[A-Za-z])(?=.*\\d).+$',
    description: 'Must contain at least one letter and one digit.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/)
  newPassword: string;
}
