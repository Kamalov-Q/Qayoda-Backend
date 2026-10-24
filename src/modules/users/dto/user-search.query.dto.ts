import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsString,
  IsOptional,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class UserSearchQueryDto {
  @ApiPropertyOptional({
    maxLength: 60,
    description:
      'Matched against name and surname, and against the two joined so a full name finds someone neither column holds alone. NOT against the phone number: a directory you can reverse-look-up a number in is a different and much worse product. Shorter than 2 characters returns nothing.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  q!: string;

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
}
