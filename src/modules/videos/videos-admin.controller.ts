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
import { VideosService } from './videos.service';
import { VideoReportsService } from './video-reports.service';
import { AdminVideosQueryDto, RemoveVideoDto } from './dto/admin-videos.dto';
import {
  AdminVideoReportsQueryDto,
  ResolveVideoReportDto,
} from './dto/video-report.dto';

/**
 * The dashboard's half: find a video, watch it, take it down.
 *
 * Everyone can post, which is the decision that makes this page necessary
 * rather than nice to have.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/videos')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class VideosAdminController {
  constructor(private readonly videos: VideosService) {}

  @ApiOperation({
    summary: 'Every video, newest first',
    description:
      'Filter by status, author, listing, or a word in the caption. Includes the ones that failed or were never paid for — those are what an upload problem looks like from here.',
  })
  @Get()
  list(@Query() query: AdminVideosQueryDto) {
    return this.videos.adminList(query);
  }

  @ApiOperation({ summary: 'One video, in any state' })
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    // Its own service method rather than `detail`, which hides anything
    // unpublished from everyone but its author — an admin reviewing a
    // takedown needs to see exactly the ones that are not public.
    return this.videos.adminDetail(id);
  }

  @ApiOperation({
    summary: 'Take a video down',
    description:
      'The reason is kept on the row. The file is deleted at Bunny a month later, so the decision can still be reviewed in the meantime.',
  })
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveVideoDto,
  ) {
    return this.videos.remove(id, user.sub, user.role, dto.reason);
  }
}

/**
 * The report queue. Its own controller because a moderator works a queue of
 * complaints, not a catalogue of videos — different table, different filters,
 * different default order.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/video-reports')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class VideoReportsAdminController {
  constructor(private readonly reports: VideoReportsService) {}

  @ApiOperation({
    summary: 'Reported videos, newest first',
    description: 'Filter by status or by video. Open ones are the work.',
  })
  @Get()
  list(@Query() query: AdminVideoReportsQueryDto) {
    return this.reports.adminList(query);
  }

  @ApiOperation({
    summary: 'How many reports are waiting',
    description: 'For the dashboard overview\'s "needs attention" number.',
  })
  @Get('open-count')
  openCount() {
    return this.reports.openCount().then((count) => ({ count }));
  }

  @ApiOperation({
    summary: 'Uphold or dismiss a report',
    description:
      'Pass `removeVideo: true` to take the clip down in the same step — upholding a complaint and acting on it are one decision. Upholding also closes every other open report about the same video.',
  })
  @Patch(':id')
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveVideoReportDto,
  ) {
    return this.reports.resolve(id, user.sub, dto);
  }
}
