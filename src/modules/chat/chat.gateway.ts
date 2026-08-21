import {
  Logger,
  OnModuleInit,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server } from 'socket.io';
import type { ChatSocket } from './types/chat-socket';
import { ChatService } from './chat.service';
import { ConversationRepository } from './repositories/conversation.repository';
import { IamFacade } from '../iam/iam.facade';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import {
  WsConversationDto,
  WsEditMessageDto,
  WsMessageIdDto,
  WsPresenceCheckDto,
  WsSendMessageDto,
  WsTypingDto,
} from './dto/ws-events.dto';
import { MessageStatus } from './enums/message-status.enum';

@UseGuards(WsJwtGuard)
@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
@WebSocketGateway({
  namespace: '/chat',
  cors: { origin: true, credentials: true },
})
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleInit
{
  private readonly logger = new Logger(ChatGateway.name);

  private readonly sockets = new Map<string, number>();

  @WebSocketServer() server: Server;

  constructor(
    private readonly chatService: ChatService,
    private readonly conversations: ConversationRepository,
    private readonly iam: IamFacade,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.iam.resetAllPresence();
  }

  // ============ lifecycle ============
  async handleConnection(client: ChatSocket) {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);

    if (!token) return client.disconnect();

    let userId: string;

    try {
      const payload = this.jwt.verify<{ sub: string }>(token, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      });
      userId = payload.sub;
    } catch {
      // Access tokens live 15 min — tell the client to refresh and reconnect
      client.emit('auth:expired');
      return client.disconnect();
    }

    client.data.userId = userId;
    await client.join(`user:${userId}`);

    const next = (this.sockets.get(userId) ?? 0) + 1;
    this.sockets.set(userId, next);

    if (next === 1) {
      await this.iam.setPresence(userId, true);
      await this.emitPresenceToCounterparts(userId, {
        userId,
        online: true,
        lastSeenAt: null,
      });
    }
    this.logger.log(`Connected ${userId} (${next} sockets)`);
  }

  async handleDisconnect(client: ChatSocket) {
    const userId = client.data?.userId;

    if (!userId) return;

    const next = (this.sockets.get(userId) ?? 1) - 1;

    if (next <= 0) {
      this.sockets.delete(userId);
      await this.iam.setPresence(userId, false);
      await this.emitPresenceToCounterparts(userId, {
        userId,
        online: false,
        lastSeenAt: new Date(),
      });
    } else {
      this.sockets.set(userId, next);
    }
  }

  private async emitPresenceToCounterparts(
    userId: string,
    payload: { userId: string; online: boolean; lastSeenAt: Date | null },
  ) {
    const counterpartIds = await this.conversations.findCounterpartIds(userId);

    for (const id of counterpartIds) {
      if (this.sockets.has(id)) {
        this.server.to(`user:${id}`).emit('presence', payload);
      }
    }
  }

  private isOnline(userId: string) {
    return this.sockets.has(userId);
  }

  // ============ events ============
  @SubscribeMessage('message:send')
  async onSend(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() data: WsSendMessageDto,
  ) {
    const senderId = client.data.userId;
    const { conversationId, ...dto } = data;

    const conv = await this.chatService.assertParticipant(
      conversationId,
      senderId,
    );

    const message = await this.chatService.sendMessage(
      conversationId,
      senderId,
      dto,
    );
    const recipientId = this.chatService.otherPartyOf(conv, senderId);

    if (this.isOnline(recipientId)) {
      await this.chatService.markDelivered(conversationId, recipientId);
      Object.assign(message, {
        status: MessageStatus.DELIVERED,
        deliveredAt: new Date(),
      });
    }

    this.server.to(`user:${recipientId}`).emit('message:new', message);
    this.server.to(`user:${senderId}`).emit('message:new', message);
    return message;
  }

  @SubscribeMessage('message:read')
  async onRead(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() data: WsConversationDto,
  ) {
    const userId = client.data.userId;
    const conv = await this.chatService.assertParticipant(
      data.conversationId,
      userId,
    );
    const result = await this.chatService.markRead(data.conversationId, userId);
    const otherId = this.chatService.otherPartyOf(conv, userId);

    // Both rooms, and `result.readBy` says which side each one is hearing
    // about. The other party needs it to tick their own messages over to READ;
    // the reader needs it to drop the unread badge — including on the reader's
    // OTHER devices, which is why it is a broadcast and not a plain ack.
    this.server.to(`user:${otherId}`).emit('message:read', result);
    this.server.to(`user:${userId}`).emit('message:read', result);
  }

  @SubscribeMessage('message:edit')
  async onEdit(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() data: WsEditMessageDto,
  ) {
    const userId = client.data.userId;

    const message = await this.chatService.editMessage(
      data.messageId,
      userId,
      data.body,
    );
    const conv = await this.chatService.assertParticipant(
      message.conversationId,
      userId,
    );
    const otherId = this.chatService.otherPartyOf(conv, userId);

    this.server.to(`user:${otherId}`).emit('message:edit', message);
    this.server.to(`user:${userId}`).emit('message:edit', message);
    return message;
  }

  @SubscribeMessage('message:delete')
  async onDelete(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() data: WsMessageIdDto,
  ) {
    const userId = client.data.userId;

    const result = await this.chatService.deleteMessage(data.messageId, userId);
    const conv = await this.chatService.assertParticipant(
      result.conversationId,
      userId,
    );
    const otherId = this.chatService.otherPartyOf(conv, userId);

    this.server.to(`user:${otherId}`).emit('message:delete', result);
    this.server.to(`user:${userId}`).emit('message:delete', result);

    return result;
  }

  @SubscribeMessage('typing')
  async onTyping(
    @ConnectedSocket() client: ChatSocket,
    @MessageBody() data: WsTypingDto,
  ) {
    const userId = client.data.userId;

    const conv = await this.chatService.assertParticipant(
      data.conversationId,
      userId,
    );

    const otherId = this.chatService.otherPartyOf(conv, userId);

    this.server.to(`user:${otherId}`).emit('typing', {
      conversationId: data.conversationId,
      userId,
      isTyping: data.isTyping,
      kind: data.kind ?? 'text',
    });
  }

  @SubscribeMessage('presence:check')
  onPresenceCheck(@MessageBody() data: WsPresenceCheckDto) {
    return this.iam.getPresence(data.userIds);
  }
}
