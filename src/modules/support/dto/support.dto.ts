import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsUUID,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const SUPPORT_MAX_LENGTH = 2000;

/** A screenshot, as `POST /media/upload` returns it. */
export class SupportImageDto {
  @ApiProperty() @IsString() url: string;
  @ApiProperty() @IsString() thumbUrl: string;
}

export class SendSupportMessageDto {
  @ApiPropertyOptional({
    maxLength: SUPPORT_MAX_LENGTH,
    description: 'Optional when `image` is sent — a screenshot is a message.',
  })
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(SUPPORT_MAX_LENGTH)
  body?: string;

  @ApiPropertyOptional({ type: SupportImageDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SupportImageDto)
  image?: SupportImageDto;
}

export class ForwardToSupportDto {
  @ApiProperty({ description: 'A message from one of your conversations.' })
  @IsUUID()
  messageId: string;
}

export class SupportQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] })
  @IsOptional()
  @IsIn(['OPEN', 'CLOSED'])
  status?: 'OPEN' | 'CLOSED';

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

export class SupportStatusDto {
  @ApiProperty({ enum: ['OPEN', 'CLOSED'] })
  @IsIn(['OPEN', 'CLOSED'])
  status: 'OPEN' | 'CLOSED';
}
