import { ApiProperty } from '@nestjs/swagger';

export class UserResponse {
  @ApiProperty({
    format: 'uuid',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  id: string;

  @ApiProperty({ format: 'email', example: 'user@example.com' })
  email: string;

  @ApiProperty({ example: 'Ada' })
  name: string;

  @ApiProperty({ example: 'Lovelace' })
  surname: string;

  @ApiProperty({
    example: true,
    description:
      'False for accounts created without a password (OTP-only sign-in).',
  })
  hasPassword: boolean;
}
