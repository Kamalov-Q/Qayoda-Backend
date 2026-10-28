import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, SelectQueryBuilder } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Listing } from '../listings/entities/listing.entity';
import { ListingImage } from '../listings/entities/listing-image.entity';
import { ListingSale } from '../listings/entities/listing-sale.entity';
import { ListingStatus } from '../listings/enums/listing-status.enum';
import { ListingsFacade } from '../listings/listings.facade';
import { UpdateListingDto } from '../listings/dto/update-listing.dto';
import { UpdateImagesDto } from '../listings/dto/update-images.dto';
import { TokenService } from '../auth/services/token.service';
import { ReportsService } from '../reports/reports.service';
import { ChatReportsService } from '../reports/chat-reports.service';
import { VerificationService } from '../verification/verification.service';
import { VideosService } from '../videos/videos.service';
import { VideoReportsService } from '../videos/video-reports.service';
import { ageFrom } from '../users/user-profile.constants';
import { RatesService } from '../../shared/rates/rates.service';
import { EskizService } from '../notifications/eskiz.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { UserRole, UserStatus } from '../../shared/enums';
import {
  AdminListingsQueryDto,
  AdminUsersQueryDto,
} from './dto/admin-query.dto';
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
    private readonly reportsService: ReportsService,
    private readonly chatReportsService: ChatReportsService,
    private readonly verificationService: VerificationService,
    // Both only for the overview's video numbers and its report queue.
    private readonly videosService: VideosService,
    private readonly videoReportsService: VideoReportsService,
    private readonly rates: RatesService,
    private readonly eskiz: EskizService,
  ) {}

  /**
   * The two live numbers an operator actually needs to see, plus the server's
   * own clock.
   *
   * The SMS balance is the important one: at zero, every phone login in the
   * country stops working, and the only warning today is a line in yesterday's
   * log. Fetched per request rather than cached — it is read by one person
   * opening one page, and a stale number here is worse than a slow one.
   */
  async system() {
    const rate = this.rates.current();

    let smsBalance: number | null = null;
    let smsError: string | null = null;
    try {
      smsBalance = await this.eskiz.getBalance();
    } catch (e) {
      // A provider outage must not take the settings page down with it.
      smsError = (e as Error).message;
    }

    return {
      usdToUzs: rate.usdToUzs,
      rateUpdatedAt: rate.updatedAt,
      smsBalance,
      smsError,
      serverTime: new Date().toISOString(),
    };
  }

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
      soldListings,
      newListings,
      listingsByCategory,
      openReports,
      openChatReports,
      pendingVerifications,
      videoStats,
      openVideoReports,
      saleStats,
    ] = await Promise.all([
      this.users.count(),
      this.users.count({ where: { role: UserRole.ADMIN } }),
      this.users
        .createQueryBuilder('u')
        .where('u.created_at >= :since', { since })
        .getCount(),
      this.listings.count(),
      this.listings.count({ where: { status: ListingStatus.ACTIVE } }),
      this.listings.count({ where: { status: ListingStatus.ARCHIVED } }),
      this.listings.count({ where: { status: ListingStatus.SOLD } }),
      this.listings
        .createQueryBuilder('l')
        .where('l.created_at >= :since', { since })
        .getCount(),
      this.countByCategory(),
      this.reportsService.openCount(),
      this.chatReportsService.openCount(),
      this.verificationService.pendingCount(),
      this.videosService.adminStats(),
      this.videoReportsService.openCount(),
      this.saleStats(since),
    ]);

    return {
      users: { total: totalUsers, admins, newThisWeek: newUsers },
      listings: {
        total: totalListings,
        active: activeListings,
        archived: archivedListings,
        // Counted separately, or the dashboard shows a total that its own
        // breakdown does not add up to: a sold listing is neither active
        // nor archived.
        sold: soldListings,
        newThisWeek: newListings,
        byCategory: listingsByCategory,
      },
      // Asking versus actual, across every sale on record. The point of
      // asking the seller for a number: one listing's discount is an
      // anecdote, the median of all of them is the market.
      sales: saleStats,
      reports: { open: openReports },
      chatReports: { open: openChatReports },
      verification: { pending: pendingVerifications },
      videos: videoStats,
      videoReports: { open: openVideoReports },
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
        // Everything they told us, age included. The public card withholds
        // these three on purpose; moderation is the case they were collected
        // for, so this is the one view that shows them.
        birthDate: u.birthDate,
        age: ageFrom(u.birthDate),
        gender: u.gender,
        address: u.address,
        bio: u.bio,
        socialLinks: u.socialLinks,
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
    if (query.status)
      qb.andWhere('l.status = :status', { status: query.status });
    if (query.q?.trim()) {
      const q = `%${query.q.trim()}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('l.title ILIKE :q', { q })
            .orWhere('l.address ILIKE :q', { q }),
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

    // What the sold ones actually went for. One query for the page, after
    // paging, for the same reason the images are: a join would multiply rows
    // under take/skip.
    const sales = ids.length
      ? await this.listings.manager.find(ListingSale, {
          where: { listingId: In(ids) },
        })
      : [];
    const saleByListing = new Map(sales.map((sale) => [sale.listingId, sale]));

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
        ratingAvg: l.ratingAvg,
        ratingCount: l.ratingCount,
        viewCount: l.viewCount,
        // When the paid TOP placement runs out, or null if it never had one.
        // A past date is a listing that WAS promoted, which is worth seeing
        // in the queue — it says somebody paid and may pay again.
        promotedUntil: l.promotedUntil,
        // TOP days bought and not yet served, banked while the advert is
        // down. Surfaced because `promotedUntil` goes null while paused, and
        // without this a paused promotion would be invisible here — which is
        // how the burning-while-sold bug stayed hidden in the first place.
        promotionRemainingSeconds: l.promotionRemainingSeconds,
        // Asking versus actual, which is the whole reason the seller is
        // asked. `discountPct` is computed here rather than in the client so
        // every dashboard reading this agrees on the sign and the rounding:
        // positive means it went for LESS than it was advertised at.
        //
        // Compared in USD, not in whatever each was quoted in — a so'm
        // asking price against a dollar sale price is two numbers, not a
        // comparison. Null when either side has no USD figure (pre-currency
        // rows), rather than a 0% that reads as "sold at asking".
        sale: saleByListing.get(l.id)
          ? {
              purpose: saleByListing.get(l.id)!.purpose,
              price: saleByListing.get(l.id)!.price,
              currency: saleByListing.get(l.id)!.currency,
              priceUsd: saleByListing.get(l.id)!.priceUsd,
              askingPrice: saleByListing.get(l.id)!.askingPrice,
              askingCurrency: saleByListing.get(l.id)!.askingCurrency,
              askingPriceUsd: saleByListing.get(l.id)!.askingPriceUsd,
              discountPct: discountPct(saleByListing.get(l.id)!),
              soldAt: saleByListing.get(l.id)!.soldAt,
            }
          : null,
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
  async setUserStatus(
    actorId: string,
    userId: string,
    dto: AdminUserStatusDto,
  ) {
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
      banReason:
        dto.status === UserStatus.BANNED ? (dto.banReason ?? null) : null,
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
   * Replaces the photo set: removed, reordered, a new cover, or photos the
   * admin uploaded through POST /media/upload. Files dropped from the set are
   * cleaned off the CDN by the same orphan job the owner's edit triggers.
   */
  async updateListingImages(id: string, dto: UpdateImagesDto) {
    await this.listingsFacade.updateImagesById(id, dto);
    return this.getListing(id);
  }

  /**
   * ACTIVE <-> ARCHIVED <-> SOLD through the listings service, so the map
   * projection, the open offers and the caches all follow. Archive is this
   * app's delete: the owner's own delete button does exactly this.
   *
   * SOLD only moves from ACTIVE, so setting it on an archived listing is
   * refused rather than quietly skipping the map cleanup it already had.
   * Restore is the way back from either.
   */
  async setListingStatus(id: string, dto: AdminListingStatusDto) {
    if (dto.status === 'ARCHIVED') await this.listingsFacade.archiveById(id);
    else if (dto.status === 'SOLD') {
      if (!dto.sale) {
        throw new BadRequestException({
          code: 'SALE_REQUIRED',
          message: 'Marking a listing sold requires the price it sold for',
        });
      }
      await this.listingsFacade.markSoldById(id, dto.sale);
    } else await this.listingsFacade.restoreById(id);
    return this.getListing(id);
  }

  /**
   * What sales look like in aggregate.
   *
   * MEDIAN, not just the mean: discounts have a long tail — one listing sold
   * at a tenth of asking (a typo, a distressed sale, a seller who entered
   * so'm in the dollar field) drags an average somewhere no actual
   * transaction is, and the dashboard then reports a market that does not
   * exist. The mean is kept beside it because the gap between the two is
   * itself the signal that something is off.
   *
   * Rows with no USD figure on either side are excluded rather than counted
   * as zero, for the same reason discountPct returns null: a missing
   * comparison is not a sale at asking price.
   */
  private async saleStats(since: Date) {
    const [row] = await this.listings.manager.query<
      {
        count: string;
        median_discount: string | null;
        avg_discount: string | null;
        total_usd: string | null;
        count_this_week: string;
      }[]
    >(
      `SELECT count(*)::int                                   AS count,
              percentile_cont(0.5) WITHIN GROUP (
                ORDER BY (1 - price_usd / asking_price_usd) * 100
              )                                               AS median_discount,
              avg((1 - price_usd / asking_price_usd) * 100)    AS avg_discount,
              sum(price_usd)                                  AS total_usd,
              count(*) FILTER (WHERE sold_at >= $1)::int       AS count_this_week
         FROM listing_sales
        WHERE price_usd IS NOT NULL
          AND asking_price_usd IS NOT NULL
          AND asking_price_usd > 0`,
      [since],
    );

    const round = (v: string | null) =>
      v === null ? null : Math.round(Number(v) * 10) / 10;

    return {
      count: Number(row?.count ?? 0),
      newThisWeek: Number(row?.count_this_week ?? 0),
      /** Percent under asking. Negative means sales are going over asking. */
      medianDiscountPct: round(row?.median_discount ?? null),
      avgDiscountPct: round(row?.avg_discount ?? null),
      /** Gross transacted value, in USD. */
      totalUsd: row?.total_usd === null ? null : Number(row?.total_usd ?? 0),
    };
  }

  /** The same row shape findUsers() returns, for mutation responses. */
  /**
   * One person, with everything the dashboard can tell about them.
   *
   * The counts come from one grouped query per table rather than a join:
   * these are five unrelated tables keyed by the same id, and a join across
   * them multiplies rows before it counts them.
   *
   * Nothing private is included — no chat contents, no saved listings. A
   * moderator deciding whether to ban somebody needs their record, not their
   * correspondence, and the chat rules elsewhere in this API say the same.
   */
  async getUser(id: string) {
    const user = await this.userRow(id);

    const [listings, reviews, comments, reportsAgainst, reportsBy, identities] =
      await Promise.all([
        this.listings.query<{ status: string; count: string }[]>(
          `SELECT status, COUNT(*)::text AS count
             FROM listings WHERE owner_id = $1 GROUP BY status`,
          [id],
        ),
        this.listings.query<{ count: string; avg: string | null }[]>(
          `SELECT COUNT(*)::text AS count, AVG(rating)::text AS avg
             FROM listing_reviews WHERE author_id = $1`,
          [id],
        ),
        this.listings.query<{ count: string }[]>(
          `SELECT COUNT(*)::text AS count
             FROM listing_comments WHERE author_id = $1`,
          [id],
        ),
        // Reports about this person's listings — the number that matters when
        // the question is whether to trust them.
        this.listings.query<{ count: string }[]>(
          `SELECT COUNT(*)::text AS count
             FROM listing_reports r
             JOIN listings l ON l.id = r.listing_id
            WHERE l.owner_id = $1`,
          [id],
        ),
        this.listings.query<{ count: string }[]>(
          `SELECT COUNT(*)::text AS count
             FROM listing_reports WHERE reporter_id = $1`,
          [id],
        ),
        this.listings.query<{ provider: string; created_at: Date }[]>(
          `SELECT provider, created_at FROM auth_identities WHERE user_id = $1`,
          [id],
        ),
      ]);

    const byStatus = new Map(listings.map((r) => [r.status, Number(r.count)]));
    const totalViews = await this.listings.query<{ sum: string | null }[]>(
      `SELECT SUM(view_count)::text AS sum FROM listings WHERE owner_id = $1`,
      [id],
    );

    return {
      ...user,
      listings: {
        total: [...byStatus.values()].reduce((a, b) => a + b, 0),
        active: byStatus.get('ACTIVE') ?? 0,
        draft: byStatus.get('DRAFT') ?? 0,
        archived: byStatus.get('ARCHIVED') ?? 0,
        sold: byStatus.get('SOLD') ?? 0,
        // How many people have opened their adverts, all told.
        views: Number(totalViews[0]?.sum ?? 0),
      },
      reviewsWritten: {
        count: Number(reviews[0]?.count ?? 0),
        average: reviews[0]?.avg
          ? Number(Number(reviews[0].avg).toFixed(1))
          : null,
      },
      commentsWritten: Number(comments[0]?.count ?? 0),
      reports: {
        against: Number(reportsAgainst[0]?.count ?? 0),
        filed: Number(reportsBy[0]?.count ?? 0),
      },
      /** How they can sign in — phone, Google, Telegram. */
      identities: identities.map((i) => ({
        provider: i.provider,
        linkedAt: i.created_at,
      })),
    };
  }

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
      birthDate: u.birthDate,
      age: ageFrom(u.birthDate),
      gender: u.gender,
      address: u.address,
      bio: u.bio,
      socialLinks: u.socialLinks,
      isOnline: u.isOnline,
      lastSeenAt: u.lastSeenAt,
      createdAt: u.createdAt,
    };
  }
}

/**
 * How far under the asking price it went, as a percentage.
 *
 * Positive is a discount, negative is over asking. Both happen, so the sign
 * carries meaning and must not be absolute.
 *
 * Numerics arrive from node-postgres as strings often enough that Number()
 * is not optional here, and a zero or missing asking price returns null —
 * dividing by it would produce Infinity, and reporting that as a percentage
 * is how a dashboard ends up showing a number nobody can explain.
 */
function discountPct(sale: ListingSale): number | null {
  const asking = Number(sale.askingPriceUsd);
  const sold = Number(sale.priceUsd);
  if (!Number.isFinite(asking) || !Number.isFinite(sold) || asking <= 0) {
    return null;
  }
  return Math.round((1 - sold / asking) * 1000) / 10;
}
