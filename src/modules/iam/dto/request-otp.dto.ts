import { IsEmail, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { OtpPurpose } from '../../otp/enums/otp-purpose.enum';

export class RequestOtpDto {
  @ApiProperty({
    format: 'email',
    example: 'user@example.com',
    description: 'Address the one-time code is delivered to.',
  })
  @IsEmail()
  email: string;

  @ApiProperty({
    enum: OtpPurpose,
    enumName: 'OtpPurpose',
    example: OtpPurpose.REGISTER,
    description:
      'What the code will be used for. The purpose is bound to the verification token you get after verifying, so it must match the endpoint you call next.',
  })
  @IsEnum(OtpPurpose)
  purpose: OtpPurpose;
}
