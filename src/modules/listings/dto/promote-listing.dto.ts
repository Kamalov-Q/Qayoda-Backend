import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

export class PromoteListingDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Which TOP tariff to buy (an id from GET /wallet, action LISTING_PROMOTE). May be omitted while exactly one is on sale.',
  })
  @IsOptional()
  @IsUUID()
  tariffId?: string;
}
