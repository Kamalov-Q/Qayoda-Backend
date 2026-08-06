import { IsUUID, IsString, Length } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyOtpDto {
  @ApiProperty({
    format: 'uuid',
    example: '9f1c2a7e-3b4d-4e5f-8a90-1b2c3d4e5f60',
    description: 'The `requestId` returned by `POST /auth/otp/request`.',
  })
  @IsUUID()
  requestId: string;

  @ApiProperty({
    example: '482913',
    minLength: 6,
    maxLength: 6,
    description: 'The 6-digit code delivered to the subject.',
  })
  @IsString()
  @Length(6, 6)
  code: string;
}
