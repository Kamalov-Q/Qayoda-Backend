import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserBlock } from './block.entity';
import { User } from '../users/entities/user.entity';

export interface BlockedPerson {
  id: string;
  name: string | null;
  surname: string | null;
  avatarThumbUrl: string | null;
  blockedAt: Date;
}

@Injectable()
export class BlocksService {
  constructor(
    @InjectRepository(UserBlock)
    private readonly blocks: Repository<UserBlock>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  /** Idempotent: blocking someone already blocked is still blocked. */
  async block(blockerId: string, blockedId: string) {
    if (blockerId === blockedId) {
      throw new BadRequestException({
        code: 'SELF_BLOCK',
        message: 'You cannot block yourself',
      });
    }

    await this.blocks
      .createQueryBuilder()
      .insert()
      .into(UserBlock)
      .values({ blockerId, blockedId })
      .orIgnore()
      .execute();

    return { blocked: true };
  }

  /** Also idempotent — unblocking someone who was never blocked succeeds. */
  async unblock(blockerId: string, blockedId: string) {
    await this.blocks.delete({ blockerId, blockedId });
    return { blocked: false };
  }

  /** The list behind "blocked users", most recent first. */
  async listFor(blockerId: string): Promise<BlockedPerson[]> {
    const rows = await this.blocks.find({
      where: { blockerId },
      order: { createdAt: 'DESC' },
    });
    if (!rows.length) return [];

    const people = await this.users.find({
      where: { id: In(rows.map((r) => r.blockedId)) },
      select: { id: true, name: true, surname: true, avatarThumbUrl: true },
    });
    const byId = new Map(people.map((p) => [p.id, p]));

    // Shaped explicitly rather than spread: `select` narrows the query, not
    // the entity type, and spreading a User here would put its password hash
    // in the response shape.
    return rows.flatMap((r) => {
      const person = byId.get(r.blockedId);
      if (!person) return [];
      return [
        {
          id: person.id,
          name: person.name,
          surname: person.surname,
          avatarThumbUrl: person.avatarThumbUrl,
          blockedAt: r.createdAt,
        },
      ];
    });
  }

  /** Have I blocked them? */
  async hasBlocked(blockerId: string, blockedId: string) {
    return this.blocks.existsBy({ blockerId, blockedId });
  }

  /**
   * Is there a block in either direction?
   *
   * One query, because almost every caller wants the symmetric answer:
   * whoever drew the line, the two of them do not talk.
   */
  async betweenAny(a: string, b: string) {
    return this.blocks.existsBy([
      { blockerId: a, blockedId: b },
      { blockerId: b, blockedId: a },
    ]);
  }

  /**
   * Refuse when either side has blocked the other.
   *
   * Deliberately the same error whichever way round it is. Telling someone
   * "they blocked you" hands them information the other person chose not to
   * give — and telling them "you blocked them" when they did is something
   * their own app already knows.
   */
  async assertNotBlocked(a: string, b: string) {
    if (await this.betweenAny(a, b)) {
      throw new ForbiddenException({
        code: 'BLOCKED',
        message: 'This conversation is not available',
      });
    }
  }

  /** Which of these people the viewer has blocked — for list screens. */
  async blockedSet(blockerId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Set<string>();

    const rows = await this.blocks.find({
      where: { blockerId, blockedId: In(unique) },
      select: { blockedId: true },
    });
    return new Set(rows.map((r) => r.blockedId));
  }
}
