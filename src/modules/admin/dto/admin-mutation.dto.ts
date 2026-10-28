import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MarkSoldDto } from '../../listings/dto/mark-sold.dto';
import { UserRole, UserStatus } from '../../../shared/enums';

export class AdminUserStatusDto {
  @ApiProperty({ enum: UserStatus })
  @IsEnum(UserStatus)
  status: UserStatus;

  /** Shown to the banned user on their next sign-in attempt. */
  @ApiPropertyOptional({ maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  banReason?: string;
}

export class AdminUserRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;
}

export class AdminListingStatusDto {
  /** DRAFT is not settable by an admin — that state belongs to the owner's editing flow. */
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED', 'SOLD'] })
  @IsIn(['ACTIVE', 'ARCHIVED', 'SOLD'])
  status: 'ACTIVE' | 'ARCHIVED' | 'SOLD';

  /**
   * Required when `status` is `SOLD`, ignored otherwise.
   *
   * An admin marking something sold owes the same number the owner does. The
   * alternative is a SOLD listing with no sale row, which is a hole in the
   * one dataset this records — and a hole that looks like a $0 sale to
   * anything averaging the column.
   */
  @ApiPropertyOptional({ type: () => MarkSoldDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => MarkSoldDto)
  sale?: MarkSoldDto;
}
