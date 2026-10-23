import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { FollowsService } from './follows.service';
import { FollowListQueryDto } from './follows.dto';

@ApiTags('Users')
@Controller('users/:id')
export class FollowsController {
  constructor(private readonly follows: FollowsService) {}

  @ApiOperation({
    summary: 'Follow state and counts for this person',
    description:
      'Public: the two numbers are printed on the profile either way. A signed-in caller also gets whether they follow them, and whether they are followed back.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get('follow')
  state(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.follows.state(user?.sub ?? null, id);
  }

  @ApiOperation({
    summary: 'Follow someone',
    description:
      'Idempotent. No request and no approval — everything here is public, so a follow is a subscription and grants no access. Refused on yourself (400) and where either side has blocked the other (403 BLOCKED).',
  })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Put('follow')
  follow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.follows.setFollow(user.sub, id, true);
  }

  @ApiOperation({ summary: 'Unfollow', description: 'Idempotent.' })
  @ApiBearerAuth('access-token')
  @UseGuards(JwtAccessGuard)
  @Delete('follow')
  unfollow(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.follows.setFollow(user.sub, id, false);
  }

  @ApiOperation({
    summary: 'Who follows this person',
    description: 'Most recently followed first. Public.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get('followers')
  followers(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FollowListQueryDto,
  ) {
    return this.follows.followers(id, user?.sub ?? null, query);
  }

  @ApiOperation({
    summary: 'Who this person follows',
    description: 'Most recently followed first. Public.',
  })
  @UseGuards(OptionalJwtGuard)
  @Get('following')
  following(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: FollowListQueryDto,
  ) {
    return this.follows.following(id, user?.sub ?? null, query);
  }
}
