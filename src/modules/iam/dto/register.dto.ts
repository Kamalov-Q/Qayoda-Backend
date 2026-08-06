import { IsString, MinLength, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Single-use token from `POST /auth/otp/verify`, issued for the `REGISTER` purpose. The account email is taken from this token, not from the request body.',
  })
  @IsString()
  verificationToken: string;

  @ApiProperty({ example: 'Ada', minLength: 2, maxLength: 64 })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  name: string;

  @ApiProperty({ example: 'Lovelace', minLength: 2, maxLength: 64 })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  surname: string;

  @ApiProperty({
    example: 'passw0rd',
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
  password: string;
}
