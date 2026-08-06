import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginOtpDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Single-use token from `POST /auth/otp/verify`, issued for the `LOGIN` purpose.',
  })
  @IsString()
  verificationToken: string;
}
