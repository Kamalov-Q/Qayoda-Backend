import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Conversation } from '../chat/entities/conversation.entity';
import { Message } from '../chat/entities/message.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import { ChatReport } from './chat-report.entity';
import {
  AdminReportsQueryDto,
  AdminReportStatusDto,
  CreateChatReportDto,
} from './dto/report.dto';

const DEFAULT_LIMIT = 20;
/** A moderator needs the conversation, not an archive; the newest are what matter. */
const TRANSCRIPT_LIMIT = 300;

@Injectable()
export class ChatReportsService {
  constructor(
    @InjectRepository(ChatReport)
    private readonly reports: Repository<ChatReport>,
    @InjectRepository(Conversation)
    private readonly conversations: Repository<Conversation>,
    @InjectRepository(Message) private readonly messages: Repository<Message>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Reporting is for the two people in the chat — nobody else can see it. */
  async create(conversationId: string, reporterId: string, dto: CreateChatReportDto) {
    const conversation = await this.conversations.findOneBy({ id: conversationId });
    if (!conversation) throw new NotFoundException('Conversation not found');

    if (conversation.hostId !== reporterId && conversation.guestId !== reporterId) {
      throw new ForbiddenException({
        code: 'NOT_PARTICIPANT',
        message: 'You are not part of this conversation',
      });
    }

    // OTHER without text tells the moderator nothing.
    if (dto.reason === 'OTHER' && !dto.comment) {
      throw new BadRequestException({
        code: 'COMMENT_REQUIRED',
        message: 'A comment is required when the reason is OTHER',
      });
    }

    if (dto.messageId) {
      // A message id from another chat would drag an unrelated thread into
      // the moderator's view.
      const belongs = await this.messages.existsBy({
        id: dto.messageId,
        conversationId,
      });
      if (!belongs) {
        throw new BadRequestException({ code: 'MESSAGE_NOT_IN_CONVERSATION' });
      }
    }

    try {
      await this.reports.insert({
        conversationId,
        reporterId,
        messageId: dto.messageId ?? null,
        reason: dto.reason,
        comment: dto.comment || null,
      });
    } catch (e) {
      // The unique constraint backs up a racing double tap.
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: 'ALREADY_REPORTED',
          message: 'You have already reported this conversation',
        });
      }
      throw e;
    }
    return { success: true };
  }

  /**
   * The dashboard's table. Deliberately no message text here: the list says
   * who reported what and why, and reading the thread is a separate, explicit
   * step (adminGet).
   */
  async adminList(query: AdminReportsQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const [rows, total] = await this.reports.findAndCount({
      where: query.status ? { status: query.status } : {},
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const conversations = await this.hydrateConversations(
      rows.map((r) => r.conversationId),
    );
    const reporters = await this.nameMap(rows.map((r) => r.reporterId));

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
        reporter: reporters.get(r.reporterId) ?? null,
        conversation: conversations.get(r.conversationId) ?? null,
      })),
    };
  }

  /**
   * The ONE way an admin reads a conversation: through a report on it. There
   * is no endpoint that takes a conversation id, so an unreported chat cannot
   * be opened from the dashboard at all.
   */
  async adminGet(reportId: string) {
    const report = await this.reports.findOneBy({ id: reportId });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND' });

    const conversations = await this.hydrateConversations([report.conversationId]);
    const reporters = await this.nameMap([report.reporterId]);

    const messages = await this.messages.find({
      where: { conversationId: report.conversationId },
      order: { createdAt: 'DESC' },
      take: TRANSCRIPT_LIMIT,
    });

    return {
      id: report.id,
      reason: report.reason,
      comment: report.comment,
      status: report.status,
      createdAt: report.createdAt,
      reporter: reporters.get(report.reporterId) ?? null,
      conversation: conversations.get(report.conversationId) ?? null,
      reportedMessageId: report.messageId,
      /** Oldest first, so the thread reads top to bottom. */
      messages: messages.reverse().map((m) => ({
        id: m.id,
        senderId: m.senderId,
        type: m.type,
        // A deleted message keeps its place in the thread — the gap is
        // evidence too — but its text is not resurrected for the moderator.
        body: m.deletedAt ? null : m.body,
        mediaUrl: m.deletedAt ? null : m.mediaUrl,
        thumbUrl: m.deletedAt ? null : m.thumbUrl,
        fileName: m.fileName,
        durationSec: m.durationSec,
        createdAt: m.createdAt,
        editedAt: m.editedAt,
        deletedAt: m.deletedAt,
      })),
      truncated: messages.length === TRANSCRIPT_LIMIT,
    };
  }

  async setStatus(id: string, dto: AdminReportStatusDto) {
    const report = await this.reports.findOneBy({ id });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND' });
    await this.reports.update(id, { status: dto.status });
    return { ...report, status: dto.status };
  }

  openCount() {
    return this.reports.countBy({ status: 'OPEN' });
  }

  // ---- helpers -----------------------------------------------------------

  /** Conversation + its listing + both participants, keyed by conversation id. */
  private async hydrateConversations(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, ConversationCard>();

    const rows = await this.conversations.find({ where: { id: In(unique) } });
    const listings = await this.listings.find({
      where: { id: In([...new Set(rows.map((c) => c.listingId))]) },
      select: { id: true, title: true, status: true },
    });
    const people = await this.nameMap(rows.flatMap((c) => [c.hostId, c.guestId]));
    const listingById = new Map(listings.map((l) => [l.id, l]));

    return new Map<string, ConversationCard>(
      rows.map((c) => [
        c.id,
        {
          id: c.id,
          lastMessageAt: c.lastMessageAt,
          host: people.get(c.hostId) ?? null,
          guest: people.get(c.guestId) ?? null,
          listing: listingById.get(c.listingId)
            ? {
                id: c.listingId,
                title: listingById.get(c.listingId)!.title,
                status: listingById.get(c.listingId)!.status,
              }
            : null,
        },
      ]),
    );
  }

  private async nameMap(ids: string[]) {
    const unique = [...new Set(ids)].filter(Boolean);
    if (!unique.length) return new Map<string, PersonCard>();
    const rows = await this.users.find({
      where: { id: In(unique) },
      select: { id: true, name: true, surname: true, phoneNumber: true },
    });
    return new Map<string, PersonCard>(
      rows.map((u) => [
        u.id,
        { id: u.id, name: u.name, surname: u.surname, phoneNumber: u.phoneNumber },
      ]),
    );
  }
}

export interface PersonCard {
  id: string;
  name: string | null;
  surname: string | null;
  phoneNumber: string | null;
}

export interface ConversationCard {
  id: string;
  lastMessageAt: Date | null;
  host: PersonCard | null;
  guest: PersonCard | null;
  listing: { id: string; title: string | null; status: string } | null;
}
