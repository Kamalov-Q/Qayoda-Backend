import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { PhoneRequiredGuard } from '../auth/guards/phone-required.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { VideosService } from './videos.service';
import { VideoEngagementService } from './video-engagement.service';
import { VideoReportsService } from './video-reports.service';
import { CreateVideoReportDto } from './dto/video-report.dto';
import {
  CreateUploadTicketDto,
  MyVideosQueryDto,
  ReportViewsDto,
  UpdateVideoDto,
  VideoFeedQueryDto,
} from './dto/video.dto';
import { RemoveVideoDto } from './dto/admin-videos.dto';
import { VIDEO_MAX_DURATION_SEC } from './videos.constants';

/** `u:<userId>` for a session, `d:<deviceId>` for a guest — see VideoView. */
const deviceKey = (deviceId?: string) => deviceId?.slice(0, 78) || null;

@ApiTags('Videos')
@Controller('videos')
export class VideosController {
  constructor(
    private readonly videos: VideosService,
    private readonly engagement: VideoEngagementService,
    private readonly reports: VideoReportsService,
  ) {}

  @ApiOperation({
    summary: 'The Videos tab',
    description: [
      'Public. Published videos, unwatched ones first, then the ones you have already seen so the feed never runs out.',
      '',
      'Keyset-paged: pass the `nextCursor` of the previous page as `cursor`, and stop when it comes back null. Sending a token or the `X-Device-Id` header is what makes "unwatched" mean anything — without either, every page is drawn from everything.',
      '',
      '`scope=following` narrows it to the people you follow, in the same order and with the same cursor.',
    ].join('\n'),
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  feed(
    @CurrentUser() user: AuthUser | null,
    @Query() query: VideoFeedQueryDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const viewerKey = user?.sub
      ? `u:${user.sub}`
      : deviceKey(deviceId)
        ? `d:${deviceKey(deviceId)}`
        : null;
    return this.videos.feed(user?.sub ?? null, viewerKey, query);
  }

  @ApiOperation({
    summary: 'Your own videos, whatever state they are in',
    description:
      'Newest first, including the ones still encoding and the ones waiting to be paid for — this is the screen that answers "where is the clip I just uploaded".',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Get('mine')
  mine(@CurrentUser() user: AuthUser, @Query() query: MyVideosQueryDto) {
    return this.videos.mine(user.sub, query);
  }

  @ApiOperation({
    summary: 'Start an upload',
    description: [
      `Returns a short-lived ticket the app uploads straight to Bunny Stream with (tus, resumable). The file never passes through this server.`,
      '',
      `Refused up front — before any bytes move — when you are over the daily posting limit (429 VIDEO_DAILY_LIMIT), when the listing is not yours (403 NOT_YOUR_LISTING), or when your balance cannot cover the posting fee (402 INSUFFICIENT_FUNDS). The fee itself is charged when Bunny confirms a valid file of ${VIDEO_MAX_DURATION_SEC} seconds or less, so an upload that fails costs nothing.`,
    ].join('\n'),
  })
  @ApiBearerAuth('access-token')
  // A posted video is public content under someone's name, so the same phone
  // gate as posting a listing applies.
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  // Each ticket creates an object at Bunny, so this is the one route here
  // worth a tighter cap than the global one.
  @Throttle({ default: { limit: 20, ttl: 60 * 60_000 } })
  @Post('upload-ticket')
  createUploadTicket(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateUploadTicketDto,
  ) {
    return this.videos.createUploadTicket(user.sub, dto);
  }

  @ApiOperation({
    summary: 'Report watched videos',
    description:
      'Send them in batches, not one request per reel. A view counts once per person per video, and only after three seconds of watching — a swipe past is not a view. Works for guests through `X-Device-Id`.',
  })
  @UseGuards(OptionalJwtGuard)
  @Post('views')
  @HttpCode(200)
  recordViews(
    @CurrentUser() user: AuthUser | null,
    @Body() dto: ReportViewsDto,
    @Headers('x-device-id') deviceId?: string,
  ) {
    return this.engagement.recordViews(
      dto,
      user?.sub ?? null,
      deviceKey(deviceId),
    );
  }

  @ApiOperation({
    summary: 'One video',
    description:
      'Public for a published video. The author also gets their own while it is still encoding or waiting for payment — everybody else gets 404.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.detail(id, user?.sub ?? null);
  }

  @ApiOperation({
    summary: 'Edit the caption, or the listing it points at',
    description:
      'Author only. Linking a listing afterwards does not re-rank a video that is already published — the head start is for the feed, not a lever to pull twice.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videos.update(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Pay for a video that is waiting',
    description:
      'For a video in AWAITING_PAYMENT: its file is encoded and valid but the wallet was empty when it finished. Charges the posting fee and publishes it. 402 INSUFFICIENT_FUNDS says what it costs and what you have.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Post(':id/publish')
  publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.publishPending(id, user.sub);
  }

  @ApiOperation({
    summary: 'Take your video down',
    description:
      'Author or admin. Nothing is refunded: the fee bought the publication, which happened. The file is deleted at Bunny a month later, so the decision can still be reviewed.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RemoveVideoDto,
  ) {
    return this.videos.remove(id, user.sub, user.role, dto.reason);
  }

  @ApiOperation({
    summary: 'Like a video',
    description: 'Idempotent — a double tap is one like.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Put(':id/like')
  like(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.engagement.setLike(id, user.sub, true);
  }

  @ApiOperation({ summary: 'Take your like back' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete(':id/like')
  unlike(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.engagement.setLike(id, user.sub, false);
  }

  @ApiOperation({
    summary: 'Report a video',
    description:
      'One report per person per video (409 ALREADY_REPORTED on the second). Needs a verified phone, like every other claim made about somebody else. Reporting your own is refused — the author has a delete button.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  @Post(':id/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVideoReportDto,
  ) {
    return this.reports.create(id, user.sub, dto);
  }

}

/**
 * The two places a video is reached from something else: a listing page and a
 * profile. Separate controllers because the path belongs to the other thing,
 * not to /videos.
 */
@ApiTags('Listings')
@Controller('listings/:id/videos')
export class ListingVideosController {
  constructor(private readonly videos: VideosService) {}

  @ApiOperation({
    summary: "A listing's videos",
    description:
      'Public, newest first. The app shows the first one on the listing page; the rest are reachable from the Videos tab.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  byListing(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.videos.byListing(id, user?.sub ?? null);
  }
}

@ApiTags('Users')
@Controller('users/:id/videos')
export class UserVideosController {
  constructor(private readonly videos: VideosService) {}

  @ApiOperation({
    summary: "Someone's published videos",
    description: 'Public. Only published ones — a profile is not a workspace.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  byAuthor(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: MyVideosQueryDto,
  ) {
    return this.videos.byAuthor(id, user?.sub ?? null, query);
  }
}
