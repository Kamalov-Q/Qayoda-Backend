import {
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { BlocksService } from './blocks.service';
import { ChatGateway } from '../chat/chat.gateway';

@ApiTags('Me')
@ApiBearerAuth('access-token')
@Controller()
@UseGuards(JwtAccessGuard)
export class BlocksController {
  constructor(
    private readonly blocks: BlocksService,
    // Only to tell the blocker's other devices; the blocked party is not
    // notified.
    private readonly gateway: ChatGateway,
  ) {}

  @ApiOperation({
    summary: 'People you have blocked',
    description: 'Most recently blocked first.',
  })
  @Get('me/blocks')
  list(@CurrentUser() user: AuthUser) {
    return this.blocks.listFor(user.sub);
  }

  @ApiOperation({
    summary: 'Block someone',
    description:
      'They can no longer open a chat with you or write in one, and your presence stops being visible to them. Idempotent. They are not told.',
  })
  @Put('users/:id/block')
  async block(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.blocks.block(user.sub, id);
    this.gateway.emitBlockChanged(user.sub, { userId: id, blocked: true });
    return result;
  }

  @ApiOperation({ summary: 'Unblock someone. Idempotent.' })
  @Delete('users/:id/block')
  async unblock(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.blocks.unblock(user.sub, id);
    this.gateway.emitBlockChanged(user.sub, { userId: id, blocked: false });
    return result;
  }
}
