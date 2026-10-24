import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { UserNotificationsService } from './user-notifications.service';
import { NOTIFICATIONS_PAGE } from './notifications.constants';

export class NotificationsQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: NOTIFICATIONS_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(NOTIFICATIONS_PAGE)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class MarkReadDto {
  @ApiPropertyOptional({
    description:
      'Leave empty to mark everything read — which is what opening the list does.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  ids?: string[];
}

/**
 * The signed-in person's inbox. Keyed by the session, with no id in any path:
 * there is deliberately no way to ask for somebody else's.
 */
@ApiTags('Me')
@ApiBearerAuth('access-token')
@Controller('me/notifications')
@UseGuards(JwtAccessGuard)
export class UserNotificationsController {
  constructor(private readonly notifications: UserNotificationsService) {}

  @ApiOperation({
    summary: 'Your notifications, newest first',
    description:
      'Each row carries whoever did it and, where there is one, the video it is about — enough to draw the row and navigate back into it.',
  })
  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: NotificationsQueryDto) {
    return this.notifications.list(user.sub, query.limit, query.offset);
  }

  @ApiOperation({
    summary: 'How many you have not seen',
    description: 'For the dot on the bell. Cheap: one indexed count.',
  })
  @Get('unread-count')
  async unread(@CurrentUser() user: AuthUser) {
    return { count: await this.notifications.unreadCount(user.sub) };
  }

  @ApiOperation({
    summary: 'Mark read',
    description:
      'Everything by default. Opening the list is what reads it — a per-row read state the UI never shows is bookkeeping nobody can act on.',
  })
  @Post('read')
  @HttpCode(200)
  markRead(@CurrentUser() user: AuthUser, @Body() dto: MarkReadDto) {
    return this.notifications.markRead(user.sub, dto.ids);
  }
}
