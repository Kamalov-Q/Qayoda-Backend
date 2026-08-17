import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAccessGuard } from '../iam/guards/jwt-access.guard';
import { CurrentUser } from '../iam/guards/current-user.decorator';
import { ChatService } from './chat.service';
import { StartConversationDto } from './dto/start-conversation.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { EditMessageDto } from './dto/edit-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages.query.dto';
import { ErrorResponse } from '../iam/responses/error.response';
import {
  ConversationListItemResponse,
  ConversationResponse,
  StartConversationResponse,
} from './responses/conversation.response';
import {
  MessageResponse,
  MessageWithReplyResponse,
} from './responses/message.response';
import {
  DeletedMessageResponse,
  ReadReceiptResponse,
} from './responses/receipt.response';
import type { AuthUser } from '../iam/types/auth-user.type';

const CONVERSATION_ID_PARAM = {
  name: 'id',
  type: String,
  format: 'uuid',
  example: '8c2a1b40-5f6d-4c3e-9a7b-1e0d5c4b3a29',
  description: 'Conversation id.',
};

const MESSAGE_ID_PARAM = {
  name: 'id',
  type: String,
  format: 'uuid',
  example: '3f1c9d2e-8b4a-4a1e-9c7f-2d6b0e5a1f34',
  description: 'Message id.',
};

const NOT_PARTICIPANT = {
  type: ErrorResponse,
  description: 'The caller is neither the host nor the guest of this conversation.',
};

const NO_CONVERSATION = {
  type: ErrorResponse,
  description: 'No conversation exists with this id.',
};

@ApiTags('Chat')
@ApiBearerAuth('access-token')
@ApiUnauthorizedResponse({
  type: ErrorResponse,
  description: 'Missing or expired access token.',
})
@UseGuards(JwtAccessGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @ApiOperation({
    summary: 'List your conversations',
    description: [
      'Every conversation the caller takes part in, as host or as guest, newest activity first.',
      '',
      'Each entry is self-sufficient for rendering the inbox: the listing title, the counterpart with their live presence, the last message preview, and the unread count — no follow-up requests needed.',
    ].join('\n'),
  })
  @ApiOkResponse({ type: [ConversationListItemResponse] })
  @Get('conversations')
  listConversations(@CurrentUser() user: AuthUser) {
    return this.chatService.listConversations(user.userId);
  }

  @ApiOperation({
    summary: 'Start a conversation',
    description: [
      'Opens a conversation about a listing and posts the first message in one call.',
      '',
      'One conversation exists per (listing, guest) pair: if the caller has already written about this listing, the existing thread is reused and the message simply appended — so this endpoint is safe to call from a "Message host" button without checking first.',
      '',
      'Owners cannot message themselves.',
    ].join('\n'),
  })
  @ApiCreatedResponse({
    type: StartConversationResponse,
    description: 'Conversation opened (or reused) and the message stored.',
  })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'Body failed validation, the message payload is incomplete for its type, or the caller owns the listing.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponse,
    description: 'No listing exists with this id.',
  })
  @Post('conversations')
  start(@CurrentUser() user: AuthUser, @Body() dto: StartConversationDto) {
    return this.chatService.startConversation(
      user.userId,
      dto.listingId,
      dto.message,
    );
  }

  @ApiOperation({
    summary: 'Get one conversation',
    description:
      'Header data for a single thread — counterpart, presence, and last-message preview. Use the messages endpoint for its contents.',
  })
  @ApiParam(CONVERSATION_ID_PARAM)
  @ApiOkResponse({ type: ConversationResponse })
  @ApiForbiddenResponse(NOT_PARTICIPANT)
  @ApiNotFoundResponse(NO_CONVERSATION)
  @Get('conversations/:id')
  getConversation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.getConversation(id, user.userId);
  }

  @ApiOperation({
    summary: 'Page through messages',
    description: [
      'Returns messages newest-first, with the replied-to message inlined as `replyTo` so a reply bubble renders without a second request.',
      '',
      'Paging is keyset, not offset: pass the `createdAt` of the oldest message you hold as `before` to load the page above it. A page shorter than `limit` means you have reached the start of the thread.',
      '',
      'Deleted messages are still returned, with `deletedAt` set and their body and media cleared — reply chains stay intact.',
    ].join('\n'),
  })
  @ApiParam(CONVERSATION_ID_PARAM)
  @ApiOkResponse({ type: [MessageWithReplyResponse] })
  @ApiForbiddenResponse(NOT_PARTICIPANT)
  @ApiNotFoundResponse(NO_CONVERSATION)
  @Get('conversations/:id/messages')
  listMessages(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.chatService.listMessages(
      id,
      user.userId,
      query.limit ?? 30,
      query.before,
    );
  }

  @ApiOperation({
    summary: 'Send a message (REST fallback)',
    description: [
      'Posts a message over HTTP. Prefer the `message:send` socket event — it is what delivers the message to the recipient in real time and returns a `DELIVERED` status when they are connected.',
      '',
      'Use this when the socket is down. The message is stored identically, and the recipient picks it up on reconnect.',
      '',
      'Attachments are uploaded first via `POST /media/chat/upload`; send the URLs it returns.',
    ].join('\n'),
  })
  @ApiParam(CONVERSATION_ID_PARAM)
  @ApiCreatedResponse({ type: MessageResponse })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'Empty text, missing `mediaUrl` for a media type, a `VOICE`/`VIDEO_NOTE` without `durationSec`, or a `replyToId` outside this conversation.',
  })
  @ApiForbiddenResponse(NOT_PARTICIPANT)
  @ApiNotFoundResponse(NO_CONVERSATION)
  @Post('conversations/:id/messages')
  send(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chatService.sendMessage(id, user.userId, dto);
  }

  @ApiOperation({
    summary: 'Mark a conversation read',
    description: [
      'Flags every unread message from the counterpart as `READ` in one sweep, and back-fills `deliveredAt` on any that never got a delivery receipt.',
      '',
      'The counterpart is notified over the socket as `message:read`.',
    ].join('\n'),
  })
  @ApiParam(CONVERSATION_ID_PARAM)
  @ApiCreatedResponse({ type: ReadReceiptResponse })
  @ApiForbiddenResponse(NOT_PARTICIPANT)
  @ApiNotFoundResponse(NO_CONVERSATION)
  @Post('conversations/:id/read')
  markRead(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.markRead(id, user.userId);
  }

  @ApiOperation({
    summary: 'Edit a message',
    description: [
      'Replaces the text of your own message within 48 hours of sending it.',
      '',
      'Only `TEXT` messages can be edited. The previous body is retained for audit and `editCount` is incremented, so clients can show an "edited" marker.',
    ].join('\n'),
  })
  @ApiParam(MESSAGE_ID_PARAM)
  @ApiOkResponse({ type: MessageResponse })
  @ApiBadRequestResponse({
    type: ErrorResponse,
    description:
      'The message is not text, is already deleted, or is older than 48 hours.',
  })
  @ApiForbiddenResponse({
    type: ErrorResponse,
    description: 'The message was sent by the other participant.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponse,
    description: 'No message exists with this id.',
  })
  @Patch('messages/:id')
  edit(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chatService.editMessage(id, user.userId, dto.body);
  }

  @ApiOperation({
    summary: 'Delete a message',
    description: [
      'Soft-deletes your own message: the row survives so reply chains stay intact, but its body, media, file name and waveform are cleared and any uploaded files are queued for CDN cleanup.',
      '',
      'Idempotent — deleting an already-deleted message returns the same payload.',
    ].join('\n'),
  })
  @ApiParam(MESSAGE_ID_PARAM)
  @ApiOkResponse({ type: DeletedMessageResponse })
  @ApiForbiddenResponse({
    type: ErrorResponse,
    description: 'The message was sent by the other participant.',
  })
  @ApiNotFoundResponse({
    type: ErrorResponse,
    description: 'No message exists with this id.',
  })
  @Delete('messages/:id')
  remove(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chatService.deleteMessage(id, user.userId);
  }
}
