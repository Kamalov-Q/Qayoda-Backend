import { ApiProperty } from '@nestjs/swagger';

export class OtpRequestResponse {
  @ApiProperty({
    format: 'uuid',
    example: '9f1c2a7e-3b4d-4e5f-8a90-1b2c3d4e5f60',
    description:
      'Pass this back to `POST /auth/otp/verify` alongside the code.',
  })
  requestId: string;

  @ApiProperty({
    example: 600,
    description:
      'Lifetime of the code in seconds (not a timestamp, despite the name).',
  })
  expiresAt: number;
}
