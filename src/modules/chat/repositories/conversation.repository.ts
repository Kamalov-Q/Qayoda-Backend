import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { Conversation } from '../entities/conversation.entity';

@Injectable()
export class ConversationRepository extends Repository<Conversation> {
  constructor(private readonly dataSource: DataSource) {
    super(Conversation, dataSource.createEntityManager());
  }

  findForUser(userId: string) {
    return this.createQueryBuilder('c')
      .where('c.host_id = :userId OR c.guest_id = :userId', { userId })
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .getMany();
  }

  findByListingAndGuest(listingId: string, guestId: string) {
    return this.findOneBy({ listingId, guestId });
  }

  async findCounterpartIds(userId: string): Promise<string[]> {
    const rows: { other: string }[] = await this.dataSource.query(
      `SELECT DISTINCT CASE WHEN host_id = $1 THEN guest_id ELSE host_id END AS other FROM conversations WHERE host_id = $1 OR guest_id = $1`,
      [userId],
    );

    return rows.map((r) => r.other);
  }
}
