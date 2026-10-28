import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Accept, decline and withdraw all take the same (optional) sentence. */
export class RespondPriceBidDto {
  @ApiPropertyOptional({
    maxLength: 500,
    description: 'Posted into the thread alongside the decision.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
