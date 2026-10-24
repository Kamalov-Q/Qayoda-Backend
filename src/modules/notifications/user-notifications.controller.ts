import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { UserNotificationsService } from './user-notifications.service';
import { ExpoPushService } from './expo-push.service';
import { NOTIFICATIONS_PAGE } from './notifications.constants';

export class RegisterPushTokenDto {
  @ApiPropertyOptional({
    description:
      "The Expo push token, e.g. ExponentPushToken[xxx]. It is the device's identity — registering an existing one RE-POINTS it at the caller rather than adding a row, so a shared phone reaches whoever signed in last.",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;

  @ApiPropertyOptional({ enum: ['ios', 'android', 'web'] })
  @IsIn(['ios', 'android', 'web'])
  platform!: string;
}

export class UnregisterPushTokenDto {
  @ApiPropertyOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  token!: string;
}

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
  constructor(
    private readonly notifications: UserNotificationsService,
    private readonly push: ExpoPushService,
  ) {}

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

  @ApiOperation({
    summary: 'Register this device for push',
    description: [
      'Idempotent, and called on every launch rather than only once: a token can be rotated by the OS, and the row carries a last-seen that is how dead installs get pruned.',
      '',
      'Registering a token that already exists RE-POINTS it at the caller. The token identifies the device, so on a shared phone the person who signed in last is who it should reach — two rows would send their messages to each other.',
    ].join('\n'),
  })
  @Post('push-tokens')
  @HttpCode(204)
  async registerPush(
    @CurrentUser() user: AuthUser,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    await this.push.register(user.sub, dto.token, dto.platform);
  }

  @ApiOperation({
    summary: 'Stop pushing to this device',
    description:
      'Sign-out. Removes this one device, never the account\u2019s others — somebody signing out on a tablet still wants their phone to buzz.',
  })
  @Delete('push-tokens')
  @HttpCode(204)
  async unregisterPush(@Body() dto: UnregisterPushTokenDto): Promise<void> {
    await this.push.unregister(dto.token);
  }
}
