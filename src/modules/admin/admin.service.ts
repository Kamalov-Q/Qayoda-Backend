import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingImage } from '../listings/entities/listing-image.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { ListingsFacade } from '../listings/listings.facade';
import { UpdateListingDto } from '../listings/dto/update-listing.dto';
import { TokenService } from '../auth/services/token.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { UserRole, UserStatus } from '../../shared/enums';
import { AdminListingsQueryDto, AdminUsersQueryDto } from './dto/admin-query.dto';
import {
  AdminListingStatusDto,
  AdminUserRoleDto,
  AdminUserStatusDto,
} from './dto/admin-mutation.dto';

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
    private readonly listingsFacade: ListingsFacade,
    private readonly tokens: TokenService,
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
      listingsByCategory,
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
      this.countByCategory(),
    ]);

    return {
      users: { total: totalUsers, admins, newThisWeek: newUsers },
      listings: {
        total: totalListings,
        active: activeListings,
        archived: archivedListings,
        newThisWeek: newListings,
        byCategory: listingsByCategory,
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

  /**
   * Status + search, applied identically to the page of rows and to the
   * category counts, so a chip's number is exactly what clicking it lists.
   * Category is NOT applied here: the counts are per category by definition.
   */
  private applyListingFilters(
    qb: SelectQueryBuilder<Listing>,
    query: AdminListingsQueryDto,
  ) {
    if (query.status) qb.andWhere('l.status = :status', { status: query.status });
    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w.where('l.title ILIKE :q', { q }).orWhere('l.address ILIKE :q', { q }),
        ),
      );
    }
    return qb;
  }

  /** Listing counts per category, as a { APARTMENT: 12, … } map. */
  private async countByCategory(query?: AdminListingsQueryDto) {
    const qb = this.listings
      .createQueryBuilder('l')
      .select('l.category', 'category')
      .addSelect('COUNT(*)', 'count')
      .groupBy('l.category');
    if (query) this.applyListingFilters(qb, query);
    const rows = await qb.getRawMany<{ category: string; count: string }>();
    // COUNT comes back as a string (bigint); categories with no listings are
    // absent from the result and read as 0 on the client.
    return Object.fromEntries(rows.map((r) => [r.category, Number(r.count)]));
  }

  async findListings(query: AdminListingsQueryDto) {
    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = query.offset ?? 0;

    // No join to users here: owners are read in one keyed query below. A raw
    // `u.id = l.owner_id` join also broke on databases where synchronize had
    // created owner_id as varchar (Postgres has no uuid = varchar operator).
    const qb = this.listings
      .createQueryBuilder('l')
      .leftJoinAndSelect('l.offers', 'o')
      .orderBy('l.created_at', 'DESC')
      .take(limit)
      .skip(offset);

    this.applyListingFilters(qb, query);
    if (query.category) {
      qb.andWhere('l.category = :category', { category: query.category });
    }

    const [[rows, total], byCategory] = await Promise.all([
      qb.getManyAndCount(),
      this.countByCategory(query),
    ]);

    // One keyed read for every owner on the page. Guarded: TypeORM reads an
    // empty `where: []` as "no condition" and would load every user.
    const ownerIds = [...new Set(rows.map((l) => l.ownerId))];
    const owners = ownerIds.length
      ? await this.users.find({
          where: { id: In(ownerIds) },
          select: { id: true, name: true, surname: true, phoneNumber: true },
        })
      : [];
    const ownerById = new Map(owners.map((o) => [o.id, o]));

    // One cover photo per row. Joined after paging, not in the main query:
    // a join there multiplies rows under take/skip and reawakens TypeORM's
    // DISTINCT-wrapper bugs.
    const ids = rows.map((l) => l.id);
    const images = ids.length
      ? await this.listings.manager.find(ListingImage, {
          where: { listingId: In(ids) },
          order: { isPrimary: 'DESC', position: 'ASC' },
        })
      : [];
    const thumbByListing = new Map<string, string>();
    for (const img of images) {
      if (!thumbByListing.has(img.listingId)) {
        thumbByListing.set(img.listingId, img.thumbUrl || img.url);
      }
    }

    return {
      total,
      byCategory,
      items: rows.map((l) => ({
        id: l.id,
        thumbUrl: thumbByListing.get(l.id) ?? null,
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

  // ---- moderation ---------------------------------------------------------

  /**
   * Ban or reactivate an account. Banning revokes every refresh token and
   * clears the access-guard cache, so the user is locked out on their next
   * request rather than when their token happens to expire.
   */
  async setUserStatus(actorId: string, userId: string, dto: AdminUserStatusDto) {
    if (userId === actorId) {
      throw new ForbiddenException({
        code: 'SELF_ACTION',
        message: 'You cannot change your own status',
      });
    }
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');
    if (user.role === UserRole.ADMIN && dto.status === UserStatus.BANNED) {
      throw new ForbiddenException({
        code: 'TARGET_IS_ADMIN',
        message: 'Demote the admin before banning them',
      });
    }

    await this.users.update(userId, {
      status: dto.status,
      banReason: dto.status === UserStatus.BANNED ? (dto.banReason ?? null) : null,
      banExpiresAt: null,
    });
    if (dto.status === UserStatus.BANNED) {
      await this.tokens.revokeAllFor(userId);
    }
    JwtAccessGuard.invalidate(userId);

    return this.userRow(userId);
  }

  /** Grant or revoke the ADMIN role. Guarded against demoting yourself. */
  async setUserRole(actorId: string, userId: string, dto: AdminUserRoleDto) {
    if (userId === actorId) {
      throw new ForbiddenException({
        code: 'SELF_ACTION',
        message: 'You cannot change your own role',
      });
    }
    const user = await this.users.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('User not found');

    await this.users.update(userId, { role: dto.role });
    JwtAccessGuard.invalidate(userId);

    return this.userRow(userId);
  }

  /** One listing with images, offers, and its owner — the drawer's payload. */
  async getListing(id: string) {
    const listing = await this.listingsFacade.findById(id);
    const owner = await this.users.findOne({
      where: { id: listing.ownerId },
      select: { id: true, name: true, surname: true, phoneNumber: true },
    });
    return {
      ...listing,
      owner: owner
        ? {
            id: owner.id,
            name: owner.name,
            surname: owner.surname,
            phoneNumber: owner.phoneNumber,
          }
        : null,
    };
  }

  /** Field edits, validated by the same DTO the owner's app uses. */
  async updateListing(id: string, dto: UpdateListingDto) {
    await this.listingsFacade.updateById(id, dto);
    return this.getListing(id);
  }

  /**
   * ACTIVE <-> ARCHIVED through the listings service, so the map projection
   * and caches follow. Archive is this app's delete: the owner's own delete
   * button does exactly this.
   */
  async setListingStatus(id: string, dto: AdminListingStatusDto) {
    if (dto.status === 'ARCHIVED') await this.listingsFacade.archiveById(id);
    else await this.listingsFacade.restoreById(id);
    return this.getListing(id);
  }

  /** The same row shape findUsers() returns, for mutation responses. */
  private async userRow(id: string) {
    const u = await this.users.findOneBy({ id });
    if (!u) throw new NotFoundException('User not found');
    return {
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
    };
  }
}
