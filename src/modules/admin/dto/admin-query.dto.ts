import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, Matches } from 'class-validator';
import { ListingStatus } from '../../listings/enums/listing-status.enum';
import { CATEGORY_SLUG } from '../../categories/categories.constants';
import { UserRole } from '../../../shared/enums';

/** Shared paging for the dashboard tables. */
export class AdminPageDto {
  @ApiPropertyOptional({ minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;

  /** Free text: name/phone/email for users, title/address for listings. */
  @ApiPropertyOptional({ maxLength: 120 })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;
}

export class AdminUsersQueryDto extends AdminPageDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}

export class AdminListingsQueryDto extends AdminPageDto {
  @ApiPropertyOptional({ enum: ListingStatus })
  @IsOptional()
  @IsEnum(ListingStatus)
  status?: ListingStatus;

  @ApiPropertyOptional({
    example: 'APARTMENT',
    description: 'A category slug (GET /categories). Omit to include every category.',
  })
  @IsOptional()
  @Matches(CATEGORY_SLUG)
  category?: string;
}
