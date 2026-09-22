import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { ReportsService } from './reports.service';
import {
  AdminReportsQueryDto,
  AdminReportStatusDto,
  CreateReportDto,
} from './dto/report.dto';

@ApiTags('Listings')
@Controller('listings')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({
    summary: 'Report a listing',
    description:
      'Flags the listing for the moderators with one of the fixed reasons; `comment` is required for OTHER, optional otherwise. One report per user per listing — a second attempt returns ALREADY_REPORTED. Owners cannot report their own listing.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Post(':id/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateReportDto,
  ) {
    return this.reportsService.create(id, user.sub, dto);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/reports')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @ApiOperation({ summary: 'Reports, newest first, with listing and reporter' })
  @Get()
  list(@Query() query: AdminReportsQueryDto) {
    return this.reportsService.adminList(query);
  }

  @ApiOperation({
    summary: 'Move a report between OPEN / RESOLVED / DISMISSED',
  })
  @Patch(':id/status')
  setStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReportStatusDto,
  ) {
    return this.reportsService.setStatus(id, dto);
  }
}
