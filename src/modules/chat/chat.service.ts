import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConversationRepository } from './repositories/conversation.repository';
import { MessageRepository } from './repositories/message.repository';
import { ListingsFacade } from '../listings/listings.facade';
import { UsersFacade } from '../users/users.facade';
import { OutBoxService } from 'src/shared/events/outbox.service';
import { DataSource } from 'typeorm';
import { SendMessageDto } from './dto/send-message.dto';
import { Conversation } from './entities/conversation.entity';
import { Message } from './entities/message.entity';
import { MessageStatus } from './enums/message-status.enum';
import { MessageType } from './enums/message-type.enum';

const EDIT_WINDOW_MS = 48 * 60 * 60 * 1000;
/** Postgres SQLSTATE for a unique constraint breach. */
const UNIQUE_VIOLATION = '23505';

@Injectable()
export class ChatService {
  constructor(
    private readonly conversations: ConversationRepository,
    private readonly messages: MessageRepository,
    private readonly listings: ListingsFacade,
    private readonly users: UsersFacade,
    private readonly outbox: OutBoxService,
    private readonly dataSource: DataSource,
  ) {}

  async startConversation(
    guestId: string,
    listingId: string,
    dto: SendMessageDto,
  ) {
    const listing = await this.listings.getSummary(listingId);

    if (listing.ownerId === guestId) {
      throw new BadRequestException(
        'You cannot start a conversation with yourself',
      );
    }

    const existing = await this.conversations.findByListingAndGuest(
      listingId,
      guestId,
    );

    if (existing) {
      const message = await this.sendMessage(existing.id, guestId, dto);
      // Re-read: sendMessage bumps lastMessageAt/preview, and `existing` is stale.
      return {
        conversation: await this.getConversation(existing.id, guestId),
        message,
      };
    }

    let conv: Conversation;

    try {
      conv = await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(Conversation);
        const created = await repo.save(
          repo.create({
            listingId,
            hostId: listing.ownerId,
            guestId,
          }),
        );

        await this.outbox.publish(
          'chat.conversation_started',
          {
            conversationId: created.id,
            listingId,
            hostId: listing.ownerId,
            guestId,
          },
          manager,
        );

        return created;
      });
    } catch (err) {
      // Two taps on "Message host" race the unique (listing_id, guest_id)
      // index; the loser reuses the row the winner just created.
      if ((err as { code?: string }).code !== UNIQUE_VIOLATION) throw err;

      const raced = await this.conversations.findByListingAndGuest(
        listingId,
        guestId,
      );
      if (!raced) throw err;
      conv = raced;
    }

    const message = await this.sendMessage(conv.id, guestId, dto);

    return {
      conversation: await this.getConversation(conv.id, guestId),
      message,
    };
  }

  async listConversations(userId: string) {
    const convs = await this.conversations.findForUser(userId);
    if (convs.length === 0) return [];

    const convIds = convs.map((c) => c.id);
    const otherIds = [
      ...new Set(convs.map((c) => this.otherPartyOf(c, userId))),
    ];

    const listingIds = [...new Set(convs.map((c) => c.listingId))];

    const [unreadMap, presence, profiles, listings] = await Promise.all([
      this.messages.countUnreadGrouped(convIds, userId),
      this.users.getPresence(otherIds),
      this.users.getPublicProfiles(otherIds),
      this.listings.getSummaries(listingIds),
    ]);

    const presenceMap = new Map(presence.map((p) => [p.userId, p]));
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const listingMap = new Map(listings.map((l) => [l.id, l]));

    return convs.map((c) => {
      const otherId = this.otherPartyOf(c, userId);
      const p = presenceMap.get(otherId);
      return {
        id: c.id,
        listingId: c.listingId,
        listingTitle: listingMap.get(c.listingId)?.title ?? null,
        role: c.hostId === userId ? ('host' as const) : ('guest' as const),
        other: {
          ...(profileMap.get(otherId) ?? { id: otherId }),
          online: p?.online ?? false,
          lastSeenAt: p?.lastSeenAt ?? null,
        },
        lastMessageAt: c.lastMessageAt,
        lastMessagePreview: c.lastMessagePreview,
        unreadCount: unreadMap.get(c.id) ?? 0,
      };
    });
  }

  async getConversation(conversationId: string, userId: string) {
    const conv = await this.assertParticipant(conversationId, userId);
    return this.toConversationDto(conv, userId);
  }

  async sendMessage(
    conversationId: string,
    senderId: string,
    dto: SendMessageDto,
  ) {
    const conv = await this.assertParticipant(conversationId, senderId);
    const recipientId = this.otherPartyOf(conv, senderId);

    if (dto.clientId) {
      const dup = await this.messages.findByClientId(
        conversationId,
        dto.clientId,
      );

      if (dup) return this.toMessageDto(dup);
    }

    this.validatePayload(dto);

    if (dto.replyToId) {
      const target = await this.messages.findOneBy({
        id: dto.replyToId,
        conversationId,
      });
      if (!target) throw new BadRequestException('Invalid reply target');
    }

    const saved = await this.dataSource.transaction(async (manager) => {
      const msgRepo = manager.getRepository(Message);
      const message = await msgRepo.save(
        msgRepo.create({
          conversationId,
          senderId,
          type: dto.type,
          body: dto.body ?? null,
          mediaUrl: dto.mediaUrl ?? null,
          thumbUrl: dto.thumbUrl ?? null,
          fileName: dto.fileName ?? null,
          fileSize: dto.fileSize != null ? String(dto.fileSize) : null,
          mimeType: dto.mimeType ?? null,
          durationSec: dto.durationSec ?? null,
          width: dto.width ?? null,
          height: dto.height ?? null,
          waveform: dto.waveform ?? null,
          replyToId: dto.replyToId ?? null,
          clientId: dto.clientId ?? null,
          status: MessageStatus.SENT,
        }),
      );

      await manager.update(Conversation, conversationId, {
        lastMessageAt: message.createdAt,
        lastMessagePreview: this.previewFor(message),
      });

      await this.outbox.publish(
        'chat.message_sent',
        { messageId: message.id, senderId, recipientId, type: message.type },
        manager,
      );

      return message;
    });

    return this.toMessageDto(saved);
  }

  async listMessages(
    conversationId: string,
    userId: string,
    limit: number,
    before?: string,
  ) {
    await this.assertParticipant(conversationId, userId);

    const rows = await this.messages.findPage(
      conversationId,
      limit,
      before ? new Date(before) : undefined,
    );

    const replyIds = [
      ...new Set(rows.map((m) => m.replyToId).filter((x): x is string => !!x)),
    ];
    const replies = await this.messages.findManyByIds(replyIds);
    const replyMap = new Map(replies.map((r) => [r.id, r]));

    return rows.map((m) => {
      const dto = this.toMessageDto(m);
      if (!m.replyToId) return { ...dto, replyTo: null };
      const r = replyMap.get(m.replyToId);
      return {
        ...dto,
        replyTo: r
          ? {
              id: r.id,
              senderId: r.senderId,
              type: r.type,
              preview: r.deletedAt ? 'Deleted message' : this.previewFor(r),
            }
          : null,
      };
    });
  }

  async editMessage(messageId: string, userId: string, body: string) {
    const msg = await this.messages.findOneBy({ id: messageId });

    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId)
      throw new ForbiddenException('This message is not yours');
    if (msg.deletedAt)
      throw new BadRequestException('This message has been deleted already');
    if (msg.type !== MessageType.TEXT)
      throw new BadRequestException('Only text messages can be edited');
    if (Date.now() - msg.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new BadRequestException(
        'Editing this message is no longer allowed (48 hours)',
      );
    }

    await this.messages.update(messageId, {
      previousBody: msg.body,
      body,
      editedAt: new Date(),
      editedBy: userId,
      editCount: msg.editCount + 1,
    });

    const updated = await this.messages.findOneBy({ id: messageId });
    return this.toMessageDto(updated!);
  }

  /** Soft delete: row survives (audit + reply chains); media queued for CDN cleanup. */
  async deleteMessage(messageId: string, userId: string) {
    const msg = await this.messages.findOneBy({ id: messageId });

    if (!msg) throw new NotFoundException('Message not found');
    if (msg.senderId !== userId)
      throw new ForbiddenException('This message is not yours');
    if (msg.deletedAt) {
      return {
        id: messageId,
        conversationId: msg.conversationId,
        deleted: true,
        deletedBy: msg.deletedBy,
      };
    }

    const orphanedUrls = [msg.mediaUrl, msg.thumbUrl].filter(
      (u): u is string => !!u,
    );

    await this.dataSource.transaction(async (manager) => {
      await manager.update(Message, messageId, {
        deletedAt: new Date(),
        deletedBy: userId,
        body: null,
        mediaUrl: null,
        thumbUrl: null,
        waveform: null,
        fileName: null,
      });

      if (orphanedUrls.length) {
        await this.outbox.publish(
          'media.files_orphaned',
          { urls: orphanedUrls },
          manager,
        );
      }
    });

    return {
      id: messageId,
      conversationId: msg.conversationId,
      deleted: true,
      deletedBy: userId,
    };
  }

  async markDelivered(conversationId: string, recipientId: string) {
    await this.messages
      .createQueryBuilder()
      .update(Message)
      .set({ status: MessageStatus.DELIVERED, deliveredAt: new Date() })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('sender_id != :recipientId', { recipientId })
      .andWhere('status = :sent', { sent: MessageStatus.SENT })
      .execute();
  }

  async markRead(conversationId: string, userId: string) {
    await this.assertParticipant(conversationId, userId);

    const now = new Date();
    await this.messages
      .createQueryBuilder()
      .update(Message)
      .set({
        status: MessageStatus.READ,
        readAt: now,
        deliveredAt: () => 'COALESCE(delivered_at, now())',
      })
      .where('conversation_id = :conversationId', { conversationId })
      .andWhere('sender_id != :userId', { userId })
      .andWhere('read_at IS NULL')
      .execute();

    return { conversationId, readAt: now, readBy: userId };
  }

  async assertParticipant(
    conversationId: string,
    userId: string,
  ): Promise<Conversation> {
    const conv = await this.conversations.findOneBy({ id: conversationId });

    if (!conv) throw new NotFoundException('Conversation not found');
    if (conv.hostId !== userId && conv.guestId !== userId) {
      throw new ForbiddenException(
        'You are not a participant of this conversation',
      );
    }
    return conv;
  }

  otherPartyOf(conv: Conversation, userId: string): string {
    return conv.hostId === userId ? conv.guestId : conv.hostId;
  }

  private validatePayload(dto: SendMessageDto) {
    if (dto.type === MessageType.TEXT) {
      if (!dto.body?.trim()) throw new BadRequestException('Empty message');
      return;
    }
    if (!dto.mediaUrl) throw new BadRequestException('Empty media URL');
    if (
      (dto.type === MessageType.VOICE || dto.type === MessageType.VIDEO_NOTE) &&
      dto.durationSec == null
    ) {
      throw new BadRequestException('Voice or video note must have duration');
    }
  }

  private previewFor(m: Message): string {
    switch (m.type) {
      case MessageType.TEXT:
        return (m.body ?? '').slice(0, 160);
      case MessageType.IMAGE:
        return '📷 Rasm';
      case MessageType.VIDEO:
        return '🎬 Video';
      case MessageType.VIDEO_NOTE:
        return '🎥 Video xabar';
      case MessageType.VOICE:
        return '🎤 Ovozli xabar';
      case MessageType.FILE:
        return `📎 ${m.fileName ?? 'Fayl'}`;
      default:
        return '';
    }
  }

  private toMessageDto(m: Message) {
    return {
      id: m.id,
      conversationId: m.conversationId,
      senderId: m.senderId,
      type: m.type,
      body: m.body,
      mediaUrl: m.mediaUrl,
      thumbUrl: m.thumbUrl,
      fileName: m.fileName,
      fileSize: m.fileSize ? Number(m.fileSize) : null,
      mimeType: m.mimeType,
      durationSec: m.durationSec,
      width: m.width,
      height: m.height,
      waveform: m.waveform,
      replyToId: m.replyToId,
      editedAt: m.editedAt,
      editedBy: m.editedBy,
      editCount: m.editCount,
      deletedAt: m.deletedAt,
      deletedBy: m.deletedBy,
      status: m.status,
      deliveredAt: m.deliveredAt,
      readAt: m.readAt,
      clientId: m.clientId,
      createdAt: m.createdAt,
    };
  }

  private async toConversationDto(c: Conversation, userId: string) {
    const otherId = this.otherPartyOf(c, userId);

    const [profiles, presence] = await Promise.all([
      this.users.getPublicProfiles([otherId]),
      this.users.getPresence([otherId]),
    ]);

    return {
      id: c.id,
      listingId: c.listingId,
      role: c.hostId === userId ? ('host' as const) : ('guest' as const),
      other: {
        ...(profiles[0] ?? { id: otherId }),
        online: presence[0]?.online ?? false,
        lastSeenAt: presence[0]?.lastSeenAt ?? null,
      },
      lastMessageAt: c.lastMessageAt,
      lastMessagePreview: c.lastMessagePreview,
    };
  }
}
