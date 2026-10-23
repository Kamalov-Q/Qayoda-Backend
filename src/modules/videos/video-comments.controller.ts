import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
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
import {
  CreateVideoCommentDto,
  VideoCommentsQueryDto,
} from './dto/video-comment.dto';

@ApiTags('Videos')
@Controller('videos/:id/comments')
export class VideoCommentsController {
  constructor(private readonly comments: VideoCommentsService) {}

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
