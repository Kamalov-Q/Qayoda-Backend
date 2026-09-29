import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { PhoneRequiredGuard } from '../auth/guards/phone-required.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ErrorResponse } from 'src/shared/responses/error.response';
import { UserRole } from 'src/shared/enums';
import { StoriesService } from './stories.service';
import {
  CreateStoryDto,
  ReactToStoryDto,
  StoryViewersQueryDto,
} from './dto/story.dto';

@ApiTags('Stories')
@Controller('stories')
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @ApiOperation({
    summary: 'The story tray',
    description: [
      'Everything still up, grouped by who posted it. Public — a signed-out reader sees the same stories, with nothing marked seen.',
      '',
      'Ordered the way every story tray is: your own first, then authors with something you have not seen, then by recency. People you have blocked, in either direction, are left out.',
    ].join('\n'),
  })
  @UseGuards(OptionalJwtGuard)
  @Get()
  tray(@CurrentUser() user: AuthUser | null) {
    return this.stories.tray(user?.sub ?? null);
  }

  @ApiOperation({
    summary: 'Post a story',
    description:
      'A photo, a video, or words on a colour — with an optional caption on any of them, and an optional listing of yours to send viewers to. Upload the media first through POST /media/stories/upload. Needs a verified phone, like posting a listing: a story is public and carries your name.',
  })
  @UseGuards(JwtAccessGuard, PhoneRequiredGuard)
  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateStoryDto) {
    return this.stories.create(user.sub, dto);
  }

  @ApiOperation({ summary: 'One story' })
  @ApiNotFoundResponse({ type: ErrorResponse })
  @UseGuards(OptionalJwtGuard)
  @Get(':id')
  get(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.get(id, user?.sub ?? null);
  }

  @ApiOperation({
    summary: 'Record that you watched it',
    description:
      'One viewer per person, and never the author — a "seen by" list exists so the poster can see who looked.',
  })
  @UseGuards(JwtAccessGuard)
  @Post(':id/view')
  @HttpCode(200)
  view(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.markSeen(id, user.sub);
  }

  @ApiOperation({
    summary: 'React to a story',
    description:
      'One reaction per person. Sending the same emoji again takes it back; sending a different one replaces it.',
  })
  @UseGuards(JwtAccessGuard)
  @Put(':id/reaction')
  react(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReactToStoryDto,
  ) {
    return this.stories.react(id, user.sub, dto);
  }

  @ApiOperation({
    summary: 'Who watched it',
    description:
      'The poster’s list, newest first, with each viewer’s reaction. Nobody else may read it.',
  })
  @ApiForbiddenResponse({ type: ErrorResponse })
  @UseGuards(JwtAccessGuard)
  @Get(':id/viewers')
  viewers(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: StoryViewersQueryDto,
  ) {
    return this.stories.viewers(id, user.sub, query);
  }

  @ApiOperation({ summary: 'Take a story down' })
  @ApiForbiddenResponse({ type: ErrorResponse })
  @UseGuards(JwtAccessGuard)
  @Delete(':id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.stories.remove(id, user.sub, user.role === UserRole.ADMIN);
  }
}
