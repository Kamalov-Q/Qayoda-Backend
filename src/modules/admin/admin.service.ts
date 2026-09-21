import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { UserRole } from '../../shared/enums';
import { AdminListingsQueryDto, AdminUsersQueryDto } from './dto/admin-query.dto';

const DEFAULT_LIMIT = 20;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Read-only views for the dashboard. Everything here reads what the app
 * already writes — no moderation actions yet (banning, review queues), which
 * need their own endpoints and audit trail.
 */
@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
  ) {}

  async overview() {
    const since = new Date(Date.now() - WEEK_MS);

    // One round trip each, counted in the database rather than by loading rows.
    const [
      totalUsers,
      admins,
      newUsers,
      totalListings,
      activeListings,
      archivedListings,
      newListings,
    ] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { role: UserRole.ADMIN } }),
      this.users.createQueryBuilder('u').where('u.created_at >= :since', { since }).getCount(),
      this.listings.count(),
      this.listings.count({ where: { status: ListingStatus.ACTIVE } }),
      this.listings.count({ where: { status: ListingStatus.ARCHIVED } }),
      this.listings
        .createQueryBuilder('l')
        .where('l.created_at >= :since', { since })
        .getCount(),
    ]);

    return {
      users: { total: totalUsers, admins, newThisWeek: newUsers },
      listings: {
        total: totalListings,
        active: activeListings,
        archived: archivedListings,
        newThisWeek: newListings,
      },
    };
  }

  async findUsers(query: AdminUsersQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const qb = this.users
      .createQueryBuilder('u')
      .orderBy('u.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.role) qb.andWhere('u.role = :role', { role: query.role });

    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('u.name ILIKE :q', { q })
            .orWhere('u.surname ILIKE :q', { q })
            .orWhere('u.phone_number ILIKE :q', { q })
            // email is citext, so ILIKE is redundant there but harmless.
            .orWhere('u.email ILIKE :q', { q }),
        ),
      );
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      total,
      items: rows.map((u) => ({
        id: u.id,
        name: u.name,
        surname: u.surname,
        phoneNumber: u.phoneNumber,
        email: u.email,
        avatarUrl: u.avatarUrl,
        role: u.role,
        status: u.status,
        isVerifiedRealtor: u.isVerifiedRealtor,
        isOnline: u.isOnline,
        lastSeenAt: u.lastSeenAt,
        createdAt: u.createdAt,
      })),
    };
  }

  async findListings(query: AdminListingsQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    const qb = this.listings
      .createQueryBuilder('l')
      // The owner's name is the column the dashboard is scanned by, so it is
      // joined rather than fetched per row.
      .leftJoin('users', 'u', 'u.id = l.owner_id')
      .addSelect(['u.id', 'u.name', 'u.surname', 'u.phone_number'])
      .leftJoinAndSelect('l.offers', 'o')
      .orderBy('l.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    if (query.status) qb.andWhere('l.status = :status', { status: query.status });

    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w.where('l.title ILIKE :q', { q }).orWhere('l.address ILIKE :q', { q }),
        ),
      );
    }

    const [rows, total] = await qb.getManyAndCount();

    // getRawAndEntities would pair these up in one pass, but the owner columns
    // are only three fields — a second keyed read is simpler to follow.
    const owners = await this.users.find({
      where: rows.map((l) => ({ id: l.ownerId })),
      select: { id: true, name: true, surname: true, phoneNumber: true },
    });
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    return {
      total,
      items: rows.map((l) => ({
        id: l.id,
        title: l.title,
        status: l.status,
        category: l.category,
        address: l.address,
        rooms: l.rooms,
        areaM2: l.areaM2,
        createdAt: l.createdAt,
        publishedAt: l.publishedAt,
        offers: l.offers?.map((o) => ({
          purpose: o.purpose,
          price: o.price,
          currency: o.currency,
          isActive: o.isActive,
        })),
        owner: ownerById.get(l.ownerId)
          ? {
              id: l.ownerId,
              name: ownerById.get(l.ownerId)!.name,
              surname: ownerById.get(l.ownerId)!.surname,
              phoneNumber: ownerById.get(l.ownerId)!.phoneNumber,
            }
          : null,
      })),
    };
  }
}
