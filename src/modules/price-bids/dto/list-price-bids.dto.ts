import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PriceBidStatus } from '../enums/price-bid-status.enum';
import { BIDS_PAGE } from '../price-bids.constants';

export class ListPriceBidsDto {
  @ApiPropertyOptional({
    enum: PriceBidStatus,
    enumName: 'PriceBidStatus',
    description: 'Only bids in this state. Omitted means all of them.',
  })
  @IsOptional()
  @IsEnum(PriceBidStatus)
  status?: PriceBidStatus;

  @ApiPropertyOptional({ default: BIDS_PAGE, maximum: BIDS_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(BIDS_PAGE)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
