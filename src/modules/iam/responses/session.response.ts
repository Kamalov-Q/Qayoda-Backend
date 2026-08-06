import { ApiProperty } from '@nestjs/swagger';
import { UserResponse } from './user.response';

export class SessionResponse {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'Bearer token for protected endpoints. Valid for 15 minutes.',
  })
  accessToken: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'Valid for 30 days and rotated on every `POST /auth/refresh`. Store it — the old one is revoked once used.',
  })
  refreshToken: string;

  @ApiProperty({ type: UserResponse })
  user: UserResponse;
}
