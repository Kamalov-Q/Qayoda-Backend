import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '../auth/types/auth-user.type';
import { Roles, RolesGuard } from '../../shared/guards/roles.guard';
import { UserRole } from '../../shared/enums';
import { SupportService } from './support.service';
import { SupportGateway } from './support.gateway';
import { ChatService } from '../chat/chat.service';
import {
  ForwardToSupportDto,
  SendSupportMessageDto,
  SupportQueryDto,
  SupportStatusDto,
} from './dto/support.dto';

@ApiTags('Support')
@ApiBearerAuth('access-token')
@Controller('support')
@UseGuards(JwtAccessGuard)
export class SupportController {
  constructor(
    private readonly support: SupportService,
    private readonly gateway: SupportGateway,
    private readonly chat: ChatService,
  ) {}

  @ApiOperation({
    summary: 'Your support thread',
    description:
      'The whole conversation with the support desk. A person who has never written gets `thread: null` and an empty list rather than a 404 — the screen is the same either way.',
  })
  @Get()
  mine(@CurrentUser() user: AuthUser) {
    return this.support.myThread(user.sub);
  }

  @ApiOperation({ summary: 'Unread answers, for the badge' })
  @Get('unread')
  unread(@CurrentUser() user: AuthUser) {
    return this.support.myUnread(user.sub);
  }

  @ApiOperation({
    summary: 'Write to support',
    description:
      'Creates the thread on the first message and reopens it if support had closed it. `body`, an `image`, or both.',
  })
  @Post('messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Body() dto: SendSupportMessageDto,
  ) {
    const message = await this.support.send(user.sub, dto);
    this.gateway.emitMessage(user.sub, message);
    return message;
  }

  @ApiOperation({
    summary: 'Forward a chat message to support',
    description:
      "Copies a message out of one of your conversations into your support thread — text, photo, voice, video or file, with the original author's name kept on it. You must be in the conversation it came from. This is how a customer hands the desk the evidence instead of describing it.",
  })
  @Post('forward')
  async forward(
    @CurrentUser() user: AuthUser,
    @Body() dto: ForwardToSupportDto,
  ) {
    // The chat service owns the permission check and the attribution; this
    // endpoint only decides where the copy lands.
    const source = await this.chat.readForwardable(dto.messageId, user.sub);

    const message = await this.support.forward(user.sub, {
      type: source.message.type,
      body: source.message.body,
      mediaUrl: source.message.mediaUrl,
      thumbUrl: source.message.thumbUrl,
      fileName: source.message.fileName,
      fileSize: source.message.fileSize,
      mimeType: source.message.mimeType,
      durationSec: source.message.durationSec,
      waveform: source.message.waveform,
      forwardedFromName: source.authorName,
      forwardedFromUserId: source.authorId,
    });

    this.gateway.emitMessage(user.sub, message);
    return message;
  }

  @ApiOperation({ summary: "Mark support's answers as read" })
  @Post('read')
  @HttpCode(200)
  read(@CurrentUser() user: AuthUser) {
    return this.support.markRead(user.sub);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('admin/support')
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminSupportController {
  constructor(
    private readonly support: SupportService,
    private readonly gateway: SupportGateway,
  ) {}

  @ApiOperation({
    summary: 'The support queue',
    description:
      'Threads with someone waiting first, then by last message. Each row carries the person and the last line said.',
  })
  @Get()
  list(@Query() query: SupportQueryDto) {
    return this.support.adminList(query);
  }

  @ApiOperation({ summary: 'Threads still open, for the sidebar badge' })
  @Get('waiting')
  waiting() {
    return this.support.adminWaitingCount();
  }

  @ApiOperation({ summary: 'One thread with its transcript' })
  @Get(':threadId')
  get(@Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.support.adminGet(threadId);
  }

  @ApiOperation({
    summary: 'Answer a thread',
    description:
      'Any admin may answer any thread — support is a desk, not a set of personal inboxes. Answering also clears the queue badge on it.',
  })
  @Post(':threadId/messages')
  async send(
    @CurrentUser() user: AuthUser,
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SendSupportMessageDto,
  ) {
    const { message, userId } = await this.support.adminSend(
      threadId,
      user.sub,
      dto,
    );
    this.gateway.emitMessage(userId, message);
    return message;
  }

  @ApiOperation({ summary: 'Close a thread, or open it again' })
  @Patch(':threadId/status')
  async setStatus(
    @Param('threadId', ParseUUIDPipe) threadId: string,
    @Body() dto: SupportStatusDto,
  ) {
    const thread = await this.support.adminSetStatus(threadId, dto);
    this.gateway.emitThread(thread.userId, thread);
    return thread;
  }

  @ApiOperation({ summary: 'Mark the thread as read by the desk' })
  @Post(':threadId/read')
  @HttpCode(200)
  read(@Param('threadId', ParseUUIDPipe) threadId: string) {
    return this.support.adminMarkRead(threadId);
  }
}
