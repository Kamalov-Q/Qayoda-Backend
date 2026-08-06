import { ApiProperty } from '@nestjs/swagger';

export class OtpVerifyResponse {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Single-use token proving the subject owns the address. Bound to the purpose the code was requested for, and consumed by the next call.',
  })
  verificationToken: string;

  @ApiProperty({
    example: 900,
    description: 'Lifetime of the verification token in seconds.',
  })
  expiresIn: number;
}
