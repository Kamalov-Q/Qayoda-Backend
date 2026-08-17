import { Injectable } from '@nestjs/common';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { Message } from '../entities/message.entity';

@Injectable()
export class MessageRepository extends Repository<Message> {
  constructor(private readonly dataSource: DataSource) {
    super(Message, dataSource.createEntityManager());
  }

  /** Newest-first page; `before` = createdAt of the oldest already-loaded message */
  findPage(conversationId: string, limit: number, before?: Date) {
    return this.find({
      where: {
        conversationId,
        ...(before ? { createdAt: LessThan(before) } : {}),
      },
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  findManyByIds(ids: string[]) {
    if (ids.length === 0) return Promise.resolve([] as Message[]);
    return this.find({ where: { id: In(ids) } });
  }

  async countUnreadGrouped(
    conversationIds: string[],
    userId: string,
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) return new Map();

    const rows: { conversation_id: string; count: number }[] =
      await this.dataSource.query(
        `
        SELECT conversation_id, COUNT(*)::int AS count
         FROM messages WHERE conversation_id = ANY($1) AND sender_id != $2 AND read_at IS NULL AND deleted_at IS NULL GROUP BY conversation_id
        `,
        [conversationIds, userId],
      );

    return new Map(rows.map((r) => [r.conversation_id, Number(r.count)]));
  }

  countUnread(conversationId: string, userId: string): Promise<number> {
    return this.createQueryBuilder('m')
      .where('m.conversation_id = :conversationId', { conversationId })
      .andWhere('m.sender_id != :userId', { userId })
      .andWhere('m.read_at IS NULL')
      .andWhere('m.deleted_at IS NULL')
      .getCount();
  }

  async countUnreadTotal(userId: string): Promise<number> {
    const rows: { count: number }[] = await this.dataSource.query(
      `SELECT COUNT(*)::int AS count FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE (c.host_id = $1 OR c.guest_id = $1) AND m.sender_id != $1 AND m.read_at IS NULL AND m.deleted_at IS NULL`,
      [userId],
    );

    return Number(rows[0]?.count ?? 0);
  }

  findByClientId(conversationId: string, clientId: string) {
    return this.findOneBy({ conversationId, clientId });
  }
}
