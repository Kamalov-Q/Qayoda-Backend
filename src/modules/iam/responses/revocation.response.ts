import { ApiProperty } from '@nestjs/swagger';

/**
 * Raw TypeORM `UpdateResult` returned by the logout endpoints.
 */
export class RevocationResponse {
  @ApiProperty({
    example: 1,
    nullable: true,
    description: 'Number of refresh tokens revoked by this call.',
  })
  affected: number | null;

  @ApiProperty({ example: [], description: 'Driver-specific result rows.' })
  raw: unknown;

  @ApiProperty({ example: [], type: [Object] })
  generatedMaps: Record<string, unknown>[];
}
