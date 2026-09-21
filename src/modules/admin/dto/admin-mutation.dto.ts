import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
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
  @ApiProperty({ enum: ['ACTIVE', 'ARCHIVED'] })
  @IsIn(['ACTIVE', 'ARCHIVED'])
  status: 'ACTIVE' | 'ARCHIVED';
}
