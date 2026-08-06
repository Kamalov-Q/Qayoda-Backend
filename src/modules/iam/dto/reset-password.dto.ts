import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Single-use token from `POST /auth/otp/verify`, issued for the `RESET_PASSWORD` purpose.',
  })
  @IsString()
  verificationToken: string;

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
  @Matches(/^(?=.*[A-Za-z])(?=.*\d).+$/, {
    message: 'Password must contain a letter and a digit',
  })
  newPassword: string;
}
