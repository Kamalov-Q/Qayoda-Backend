import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { PhoneRequiredGuard } from '../auth/guards/phone-required.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { VideoCommentsService } from './video-comments.service';
import { VideoReportsService } from './video-reports.service';
import { CreateVideoReportDto } from './dto/video-report.dto';
import {
  CreateVideoCommentDto,
  UpdateVideoCommentDto,
  VideoCommentsQueryDto,
} from './dto/video-comment.dto';

@ApiTags('Videos')
@Controller('videos/:id/comments')
export class VideoCommentsController {
  constructor(
    private readonly comments: VideoCommentsService,
    private readonly reports: VideoReportsService,
  ) {}

  @ApiOperation({
    summary: 'The comments under a video',
    description:
      'Public. Newest first, each with its first couple of replies. A signed-in caller also gets `likedByMe` on every row.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  list(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: VideoCommentsQueryDto,
  ) {
    return this.comments.list(id, user?.sub ?? null, query);
  }

  @ApiOperation({
    summary: "The rest of one comment's replies",
    description: 'Oldest first — an exchange only reads forward. Public.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get(':commentId/replies')
  replies(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Query() query: VideoCommentsQueryDto,
  ) {
    return this.comments.listReplies(id, commentId, user?.sub ?? null, query);
  }

  @ApiOperation({
    summary: 'Comment, or reply to a comment',
    description:
      "Pass `parentId` to reply. Threads are one level deep: replying to a reply returns 400 REPLY_TOO_DEEP. Needs a verified phone, like every other thing said publicly under somebody else's name.",
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateVideoCommentDto,
  ) {
    return this.comments.create(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Edit your own comment',
    description:
      'Author only — 403 NOT_YOUR_COMMENT for anyone else. The words, not the photo: a comment people have already replied to should not be able to become a different comment.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Patch(':commentId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateVideoCommentDto,
  ) {
    return this.comments.update(id, commentId, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Delete a comment',
    description:
      "Its author, the video's author, or an admin. Deleting a top-level comment takes its replies with it.",
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete(':commentId')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.remove(id, commentId, user.sub, user.role);
  }

  @ApiOperation({
    summary: 'Report a comment',
    description:
      'One report per person per comment (409 ALREADY_REPORTED on the second). Lands in the same queue as video reports, because it is the same judgement by the same moderator. Reporting your own is refused — you can delete it.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  @Post(':commentId/report')
  report(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: CreateVideoReportDto,
  ) {
    return this.reports.createForComment(id, commentId, user.sub, dto);
  }

  @ApiOperation({ summary: 'Like a comment', description: 'Idempotent.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Put(':commentId/like')
  like(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.setLike(id, commentId, user.sub, true);
  }

  @ApiOperation({ summary: 'Take your like back' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete(':commentId/like')
  unlike(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
  ) {
    return this.comments.setLike(id, commentId, user.sub, false);
  }
}
