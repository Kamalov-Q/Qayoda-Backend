import {
  Controller,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OptionalJwtGuard } from '../auth/guards/optional-jwt.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { ViewsService } from './views.service';
import { ViewsGateway } from './views.gateway';

@ApiTags('Listings')
@Controller('listings/:id')
export class ViewsController {
  constructor(
    private readonly views: ViewsService,
    private readonly gateway: ViewsGateway,
  ) {}

  @ApiOperation({
    summary: 'Record that you opened this listing',
    description: [
      'One view per person: a signed-in caller is counted by user id, a guest by the `X-Device-Id` header the app generates once and keeps. Repeat visits do not add to the count, and owners viewing their own listing are not counted at all.',
      '',
      'Returns the current count either way, and pushes it to everyone watching this listing on the `/listings` websocket namespace.',
    ].join('\n'),
  })
  @UseGuards(OptionalJwtGuard)
  @Post('view')
  @HttpCode(200)
  async record(
    @CurrentUser() user: AuthUser | null,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('x-device-id') deviceId?: string,
  ) {
    const result = await this.views.record(
      id,
      user?.sub ?? null,
      // Length-capped rather than validated: the column is varchar(80) with
      // a 2-character prefix, and a client sending junk only miscounts
      // itself.
      deviceId?.slice(0, 78) || null,
    );

    // Only when it moved: a re-read by the same person would otherwise
    // re-render the number on every other device for no reason.
    if (result.counted) {
      this.gateway.broadcast(id, result.viewCount);
    }
    return result;
  }
}
