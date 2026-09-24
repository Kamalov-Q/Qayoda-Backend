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
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { CommentsService } from './comments.service';
import {
  CommentsQueryDto,
  CreateCommentDto,
  UpdateCommentDto,
} from './dto/comment.dto';

@ApiTags('Listings')
@Controller('listings/:id/comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @ApiOperation({
    summary: 'The comment thread under a listing',
    description:
      'Public. Top-level comments newest first, each carrying its first couple of replies and its like count. A signed-in caller also gets `likedByMe` on every row — sending a token is optional and changes nothing else.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  list(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: CommentsQueryDto,
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
    @Query() query: CommentsQueryDto,
  ) {
    return this.comments.listReplies(id, commentId, user?.sub ?? null, query);
  }

  @ApiOperation({
    summary: 'Leave a comment, or reply to one',
    description:
      'Pass `parentId` to reply. Threads are one level deep: replying to a reply returns 400 REPLY_TOO_DEEP. Needs a verified phone.',
  })
  @ApiBearerAuth('access-token')
  // Phone gate: a comment sits publicly under someone else's advert, so it
  // needs an account answerable at a verified number.
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  @Post()
  create(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCommentDto,
  ) {
    return this.comments.create(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Edit your own comment',
    description: 'Author only — 403 NOT_YOUR_COMMENT for anyone else.',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Patch(':commentId')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('commentId', ParseUUIDPipe) commentId: string,
    @Body() dto: UpdateCommentDto,
  ) {
    return this.comments.update(id, commentId, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Delete a comment',
    description:
      "The author, the listing's owner, or an admin. Deleting a top-level comment takes its replies with it.",
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
    summary: 'Like a comment',
    description: 'Idempotent — liking twice is one like.',
  })
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

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/comments')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminCommentsController {
  constructor(private readonly comments: CommentsService) {}

  @ApiOperation({ summary: 'Every comment, newest first, with its listing' })
  @Get()
  list(@Query() query: CommentsQueryDto) {
    return this.comments.adminList(query);
  }

  @ApiOperation({
    summary: 'Delete a comment',
    description: 'Takes its replies with it, same as the owner-facing route.',
  })
  @Delete(':commentId')
  remove(@Param('commentId', ParseUUIDPipe) commentId: string) {
    return this.comments.adminRemove(commentId);
  }
}
