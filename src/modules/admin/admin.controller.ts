import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { UpdateListingDto } from '../listings/dto/update-listing.dto';
import { AdminService } from './admin.service';
import { AdminListingsQueryDto, AdminUsersQueryDto } from './dto/admin-query.dto';
import {
  AdminListingStatusDto,
  AdminUserRoleDto,
  AdminUserStatusDto,
} from './dto/admin-mutation.dto';

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

  @ApiOperation({
    summary: 'Live system numbers',
    description:
      "The CBU rate the app prices with, the Eskiz SMS balance (null with `smsError` set when the provider cannot be reached), and the server's clock.",
  })
  @Get('system')
  system() {
    return this.admin.system();
  }

  @ApiOperation({ summary: 'Users, newest first' })
  @Get('users')
  users(@Query() query: AdminUsersQueryDto) {
    return this.admin.findUsers(query);
  }

  @ApiOperation({
    summary: 'One user, with their record',
    description:
      'Profile, sign-in methods, listing counts and total views, reviews and comments written, and reports both against their listings and filed by them. Nothing private — no chat contents and no saved listings.',
  })
  @Get('users/:id')
  user(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getUser(id);
  }

  @ApiOperation({ summary: 'Listings, newest first' })
  @Get('listings')
  listings(@Query() query: AdminListingsQueryDto) {
    return this.admin.findListings(query);
  }

  @ApiOperation({
    summary: 'Ban or reactivate a user',
    description:
      'Banning also revokes every refresh token, so the account is locked out immediately. Admins cannot ban themselves or other admins (demote first).',
  })
  @Patch('users/:id/status')
  setUserStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUserStatusDto,
  ) {
    return this.admin.setUserStatus(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'Grant or revoke the ADMIN role' })
  @Patch('users/:id/role')
  setUserRole(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminUserRoleDto,
  ) {
    return this.admin.setUserRole(user.sub, id, dto);
  }

  @ApiOperation({ summary: 'One listing with images, offers, and owner' })
  @Get('listings/:id')
  listing(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getListing(id);
  }

  @ApiOperation({
    summary: 'Edit listing fields',
    description: 'Same validation as the owner-facing update endpoint.',
  })
  @Patch('listings/:id')
  updateListing(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateListingDto,
  ) {
    return this.admin.updateListing(id, dto);
  }

  @ApiOperation({
    summary: 'Activate or archive a listing',
    description:
      'Goes through the same flow as the owner archive/restore, so map projection and caches stay in sync.',
  })
  @Patch('listings/:id/status')
  setListingStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminListingStatusDto,
  ) {
    return this.admin.setListingStatus(id, dto);
  }

  @ApiOperation({
    summary: 'Archive a listing (the app’s delete)',
    description:
      'Identical to the owner pressing delete: soft-archive, off the map, record kept.',
  })
  @Delete('listings/:id')
  deleteListing(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.setListingStatus(id, { status: 'ARCHIVED' });
  }
}
