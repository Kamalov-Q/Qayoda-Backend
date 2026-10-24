import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class FollowListQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  @ApiPropertyOptional({
    maxLength: 60,
    description:
      'Narrows the list to people whose name or surname contains this. Matched on the server because these pages are 25 long \u2014 filtering the loaded page in the client would search a screenful and silently miss the rest. Shorter than 2 characters is ignored.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  q?: string;
}
