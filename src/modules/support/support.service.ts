import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { SupportMessage, SupportThread } from './support.entity';
import { User } from '../users/entities/user.entity';
import {
  SendSupportMessageDto,
  SupportQueryDto,
  SupportStatusDto,
} from './dto/support.dto';

const DEFAULT_LIMIT = 20;
/** Newest N messages of a thread. Support threads are short; this is a guard,
 *  not a paging scheme. */
const TRANSCRIPT_LIMIT = 200;

/** A chat message, reduced to what a support thread needs to re-show it. */
export interface ForwardPayload {
  type: string;
  body: string | null;
  mediaUrl: string | null;
  thumbUrl: string | null;
  fileName: string | null;
  fileSize: string | null;
  mimeType: string | null;
  durationSec: number | null;
  waveform: number[] | null;
  forwardedFromName: string | null;
}

export interface Person {
  id: string;
  name: string | null;
  surname: string | null;
  phoneNumber: string | null;
  avatarThumbUrl: string | null;
}

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportThread)
    private readonly threads: Repository<SupportThread>,
    @InjectRepository(SupportMessage)
    private readonly messages: Repository<SupportMessage>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly ds: DataSource,
  ) {}

  // ---------------------------------------------------------------- user side

  /**
   * The signed-in person's own thread and its messages.
   *
   * Returns an empty thread rather than 404 when they have never written:
   * the screen is the same either way, and "you have no support thread" is
   * not something a user should have to be told.
   */
  async myThread(userId: string) {
    const thread = await this.threads.findOneBy({ userId });
    if (!thread) {
      return { thread: null, messages: [] };
    }

    const messages = await this.transcript(thread.id);
    return { thread: this.shapeThread(thread), messages };
  }

  /** Write to support. Creates the thread on the first message. */
  async send(userId: string, dto: SendSupportMessageDto) {
    const body = dto.body?.trim() ?? '';
    // Any attachment counts as content: a voice note with no caption is a
    // message, and refusing it would be refusing the commonest kind.
    if (!body && !dto.image && !dto.mediaUrl) {
      throw new BadRequestException({
        code: 'MESSAGE_EMPTY',
        message: 'Write something or attach a file',
      });
    }

    const message = await this.ds.transaction(async (m) => {
      let thread = await m.findOne(SupportThread, { where: { userId } });

      if (!thread) {
        thread = await m.save(m.create(SupportThread, { userId }));
      }

      const saved = await m.save(
        m.create(SupportMessage, {
          threadId: thread.id,
          senderId: userId,
          fromAdmin: false,
          ...this.attachmentOf(dto, body),
        }),
      );

      await m.update(SupportThread, thread.id, {
        // Writing again reopens a closed thread: from the customer's side
        // there is no such thing as a conversation support has ended.
        status: 'OPEN',
        lastMessageAt: saved.createdAt,
        adminUnread: thread.adminUnread + 1,
      });

      return saved;
    });

    return this.shapeMessage(message);
  }

  /**
   * Put a forwarded chat message into this person's support thread.
   *
   * This is the point of forwarding to support: instead of describing "the
   * seller sent me a voice note demanding a deposit", they hand the desk the
   * voice note. Content is copied, so it survives the original being deleted
   * — which, in an argument worth reporting, it often is.
   */
  async forward(userId: string, source: ForwardPayload) {
    const message = await this.ds.transaction(async (m) => {
      let thread = await m.findOne(SupportThread, { where: { userId } });
      if (!thread) thread = await m.save(m.create(SupportThread, { userId }));

      const isImage = source.type === 'IMAGE';

      const saved = await m.save(
        m.create(SupportMessage, {
          threadId: thread.id,
          senderId: userId,
          fromAdmin: false,
          type: source.type,
          body: source.body ?? '',
          // Images keep the dedicated pair the composer already writes;
          // everything else travels in the generic media columns.
          imageUrl: isImage ? source.mediaUrl : null,
          imageThumbUrl: isImage ? (source.thumbUrl ?? source.mediaUrl) : null,
          mediaUrl: isImage ? null : source.mediaUrl,
          fileName: source.fileName ?? null,
          fileSize: source.fileSize ?? null,
          mimeType: source.mimeType ?? null,
          durationSec: source.durationSec ?? null,
          waveform: source.waveform ?? null,
          forwardedFromName: source.forwardedFromName ?? null,
        }),
      );

      await m.update(SupportThread, thread.id, {
        status: 'OPEN',
        lastMessageAt: saved.createdAt,
        adminUnread: thread.adminUnread + 1,
      });

      return saved;
    });

    return this.shapeMessage(message);
  }

  /** The user has read whatever support wrote. */
  async markRead(userId: string) {
    await this.threads.update(
      { userId },
      { userUnread: 0, userReadAt: new Date() },
    );
    return { success: true };
  }

  /** For the tab badge — one number, no transcript. */
  async myUnread(userId: string) {
    const thread = await this.threads.findOne({
      where: { userId },
      select: { userUnread: true },
    });
    return { unread: thread?.userUnread ?? 0 };
  }

  // --------------------------------------------------------------- admin side

  /** The queue: threads with someone waiting first. */
  async adminList(q: SupportQueryDto) {
    const limit = q.limit ?? DEFAULT_LIMIT;
    const offset = q.offset ?? 0;

    const [rows, total] = await this.threads.findAndCount({
      where: q.status ? { status: q.status } : {},
      // Longest wait first within the unanswered ones — a queue sorted by
      // anything else leaves somebody permanently at the bottom.
      order: { adminUnread: 'DESC', lastMessageAt: 'DESC' },
      take: limit,
      skip: offset,
    });

    const people = await this.people(rows.map((t) => t.userId));

    // One keyed read for the last line of every thread on the page, rather
    // than a query per row.
    const lastByThread = await this.lastMessages(rows.map((t) => t.id));

    return {
      total,
      items: rows.map((t) => ({
        ...this.shapeThread(t),
        user: people.get(t.userId) ?? null,
        lastMessage: lastByThread.get(t.id) ?? null,
      })),
    };
  }

  async adminGet(threadId: string) {
    const thread = await this.threads.findOneBy({ id: threadId });
    if (!thread) throw new NotFoundException('Thread not found');

    const [messages, people] = await Promise.all([
      this.transcript(thread.id),
      this.people([thread.userId]),
    ]);

    return {
      ...this.shapeThread(thread),
      user: people.get(thread.userId) ?? null,
      messages,
    };
  }

  /** An admin answers. Any admin may answer any thread — support is a desk,
   *  not a set of personal inboxes. */
  async adminSend(
    threadId: string,
    adminId: string,
    dto: SendSupportMessageDto,
  ) {
    const body = dto.body?.trim() ?? '';
    // Any attachment counts as content: a voice note with no caption is a
    // message, and refusing it would be refusing the commonest kind.
    if (!body && !dto.image && !dto.mediaUrl) {
      throw new BadRequestException({
        code: 'MESSAGE_EMPTY',
        message: 'Write something or attach a file',
      });
    }

    const thread = await this.threads.findOneBy({ id: threadId });
    if (!thread) throw new NotFoundException('Thread not found');

    const message = await this.ds.transaction(async (m) => {
      const saved = await m.save(
        m.create(SupportMessage, {
          threadId,
          senderId: adminId,
          fromAdmin: true,
          ...this.attachmentOf(dto, body),
        }),
      );

      await m.update(SupportThread, threadId, {
        lastMessageAt: saved.createdAt,
        userUnread: thread.userUnread + 1,
        // Answering clears the queue badge: the desk has dealt with it, and
        // a separate "mark read" click for every reply is a click for nothing.
        adminUnread: 0,
        adminReadAt: saved.createdAt,
      });

      return saved;
    });

    return { message: this.shapeMessage(message), userId: thread.userId };
  }

  async adminSetStatus(threadId: string, dto: SupportStatusDto) {
    const thread = await this.threads.findOneBy({ id: threadId });
    if (!thread) throw new NotFoundException('Thread not found');

    await this.threads.update(threadId, { status: dto.status });
    return { ...this.shapeThread({ ...thread, status: dto.status }), userId: thread.userId };
  }

  /** Opening a thread in the dashboard is reading it. */
  async adminMarkRead(threadId: string) {
    await this.threads.update(threadId, {
      adminUnread: 0,
      adminReadAt: new Date(),
    });
    return { success: true };
  }

  /** The sidebar badge: how many threads are waiting on an answer. */
  async adminWaitingCount() {
    const waiting = await this.threads.count({ where: { status: 'OPEN' } });
    return { waiting };
  }

  // ------------------------------------------------------------------ helpers

  /**
   * One message's content columns, from whichever shape the caller sent.
   *
   * `image` is the composer's own upload; `mediaUrl` is everything else,
   * including anything forwarded in from a chat. Images keep their dedicated
   * pair so the existing rendering does not have to learn a second way to
   * find a photo.
   */
  private attachmentOf(dto: SendSupportMessageDto, body: string) {
    const type = dto.type ?? (dto.image ? 'IMAGE' : 'TEXT');
    const isImage = type === 'IMAGE';
    const url = dto.image?.url ?? dto.mediaUrl ?? null;

    return {
      type,
      body,
      imageUrl: isImage ? url : null,
      imageThumbUrl: isImage
        ? (dto.image?.thumbUrl ?? dto.thumbUrl ?? url)
        : null,
      mediaUrl: isImage ? null : url,
      fileName: dto.fileName ?? null,
      fileSize: dto.fileSize != null ? String(dto.fileSize) : null,
      mimeType: dto.mimeType ?? null,
      durationSec: dto.durationSec ?? null,
      waveform: dto.waveform ?? null,
    };
  }

  private async transcript(threadId: string) {
    const rows = await this.messages.find({
      where: { threadId },
      order: { createdAt: 'DESC' },
      take: TRANSCRIPT_LIMIT,
    });
    // Read back in order; the DESC above is only how the cap picks which end.
    return rows.reverse().map((m) => this.shapeMessage(m));
  }

  private async lastMessages(threadIds: string[]) {
    if (!threadIds.length) return new Map<string, string>();

    const rows = await this.messages.find({
      where: { threadId: In(threadIds) },
      order: { createdAt: 'DESC' },
      select: { threadId: true, body: true, imageUrl: true, createdAt: true },
    });

    const byThread = new Map<string, string>();
    for (const row of rows) {
      if (byThread.has(row.threadId)) continue;
      byThread.set(row.threadId, row.body || (row.imageUrl ? '📷' : ''));
    }
    return byThread;
  }

  private async people(ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map<string, Person>();

    const users = await this.users.find({
      where: { id: In(unique) },
      select: {
        id: true,
        name: true,
        surname: true,
        phoneNumber: true,
        avatarThumbUrl: true,
      },
    });
    return new Map<string, Person>(users.map((u) => [u.id, u as Person]));
  }

  private shapeThread(t: SupportThread) {
    return {
      id: t.id,
      userId: t.userId,
      status: t.status,
      lastMessageAt: t.lastMessageAt,
      // A message is "read" when the other side's read stamp is later than
      // it — one timestamp per side rather than a flag per message.
      userReadAt: t.userReadAt,
      adminReadAt: t.adminReadAt,
      userUnread: t.userUnread,
      adminUnread: t.adminUnread,
      createdAt: t.createdAt,
    };
  }

  private shapeMessage(m: SupportMessage) {
    return {
      id: m.id,
      threadId: m.threadId,
      senderId: m.senderId,
      fromAdmin: m.fromAdmin,
      type: m.type,
      body: m.body,
      imageUrl: m.imageUrl,
      imageThumbUrl: m.imageThumbUrl,
      mediaUrl: m.mediaUrl,
      fileName: m.fileName,
      fileSize: m.fileSize ? Number(m.fileSize) : null,
      mimeType: m.mimeType,
      durationSec: m.durationSec,
      waveform: m.waveform,
      forwardedFromName: m.forwardedFromName,
      createdAt: m.createdAt,
    };
  }
}
