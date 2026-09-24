import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Long enough for a real question, short enough to read in a thread. */
export const COMMENT_MAX_LENGTH = 1000;

export class CreateCommentDto {
  @ApiProperty({ maxLength: COMMENT_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMMENT_MAX_LENGTH)
  body: string;

  @ApiPropertyOptional({
    description:
      'The top-level comment this replies to. Replying to a reply is refused — threads are one level deep.',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class UpdateCommentDto {
  @ApiProperty({ maxLength: COMMENT_MAX_LENGTH })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(COMMENT_MAX_LENGTH)
  body: string;
}

export class CommentsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 })
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
