import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description:
      'The `refreshToken` from the last session response. Sent in the body — this endpoint does not read the `Authorization` header.',
  })
  @IsString()
  refreshToken: string;
}
