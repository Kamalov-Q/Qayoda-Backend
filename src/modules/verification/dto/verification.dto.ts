import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const VERIFICATION_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
] as const;

/** Short enough to stay a message, long enough to explain what was wrong. */
export const REJECTION_REASON_MAX = 1000;

export class SubmitVerificationDto {
  @ApiProperty({
    description: 'From POST /media/verification/upload.',
    example: 'https://cdn.example.com/kyc/2026-09/3f1c9d2e.jpg',
  })
  @IsString()
  @MaxLength(500)
  passportFrontUrl: string;

  @ApiProperty({ description: 'From POST /media/verification/upload.' })
  @IsString()
  @MaxLength(500)
  passportBackUrl: string;

  @ApiProperty({
    description:
      'The applicant holding the document. This is the part that ties the ' +
      'passport to the person applying.',
  })
  @IsString()
  @MaxLength(500)
  selfieUrl: string;
}

export class RejectVerificationDto {
  @ApiProperty({
    maxLength: REJECTION_REASON_MAX,
    description:
      'Sent to the applicant as a support message, word for word. Write it ' +
      'as something a person reads, not as a status code.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(REJECTION_REASON_MAX)
  reason: string;
}

export class AdminVerificationQueryDto {
  @ApiPropertyOptional({ enum: VERIFICATION_STATUSES })
  @IsOptional()
  @IsIn(VERIFICATION_STATUSES)
  status?: (typeof VERIFICATION_STATUSES)[number];

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
