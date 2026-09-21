import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { AdminService } from './admin.service';
import { AdminListingsQueryDto, AdminUsersQueryDto } from './dto/admin-query.dto';

/**
 * Everything the web dashboard reads. Guarded twice on purpose: JwtAccessGuard
 * identifies the caller and re-reads their role from the database, RolesGuard
 * then demands ADMIN — so revoking someone's admin rights takes effect on
 * their very next request, without waiting for their token to expire.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @ApiOperation({
    summary: 'Dashboard counters',
    description:
      'User and listing totals plus the last seven days. Also the cheapest way for the dashboard to confirm the signed-in account is still an admin.',
  })
  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @ApiOperation({ summary: 'Users, newest first' })
  @Get('users')
  users(@Query() query: AdminUsersQueryDto) {
    return this.admin.findUsers(query);
  }

  @ApiOperation({ summary: 'Listings, newest first' })
  @Get('listings')
  listings(@Query() query: AdminListingsQueryDto) {
    return this.admin.findListings(query);
  }
}
