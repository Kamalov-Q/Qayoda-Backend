import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { ListingReport } from './report.entity';
import { Listing } from '../listings/entities/listing.entity';
import { User } from '../users/entities/user.entity';
import {
  AdminReportsQueryDto,
  AdminReportStatusDto,
  CreateReportDto,
} from './dto/report.dto';

const DEFAULT_LIMIT = 20;

@Injectable()
export class ReportsService {
  constructor(
    @InjectRepository(ListingReport)
    private readonly reports: Repository<ListingReport>,
    @InjectRepository(Listing) private readonly listings: Repository<Listing>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  async create(listingId: string, reporterId: string, dto: CreateReportDto) {
    const listing = await this.listings.findOneBy({ id: listingId });
    if (!listing) throw new NotFoundException('Listing not found');

    if (listing.ownerId === reporterId) {
      throw new ForbiddenException({
        code: 'OWN_LISTING',
        message: 'You cannot report your own listing',
      });
    }

    // OTHER without text tells the moderator nothing.
    if (dto.reason === 'OTHER' && !dto.comment) {
      throw new BadRequestException({
        code: 'COMMENT_REQUIRED',
        message: 'A comment is required when the reason is OTHER',
      });
    }

    if (await this.reports.existsBy({ listingId, reporterId })) {
      throw new ConflictException({
        code: 'ALREADY_REPORTED',
        message: 'You have already reported this listing',
      });
    }

    try {
      await this.reports.insert({
        listingId,
        reporterId,
        reason: dto.reason,
        comment: dto.comment || null,
      });
    } catch (e) {
      // The unique constraint backs up the existsBy check under a race.
      if ((e as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: 'ALREADY_REPORTED',
          message: 'You have already reported this listing',
        });
      }
      throw e;
    }
    return { success: true };
  }

  /**
   * The dashboard's table: paged reports hydrated with the listing and the
   * reporter in two keyed reads — no joins under take/skip.
   */
  async adminList(query: AdminReportsQueryDto) {
    const where = query.status ? { status: query.status } : {};
    const [rows, total] = await this.reports.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      take: query.limit ?? DEFAULT_LIMIT,
      skip: query.offset ?? 0,
    });

    const listingIds = [...new Set(rows.map((r) => r.listingId))];
    const reporterIds = [...new Set(rows.map((r) => r.reporterId))];
    const [listings, reporters] = await Promise.all([
      listingIds.length
        ? this.listings.find({
            where: { id: In(listingIds) },
            select: { id: true, title: true, status: true, address: true },
          })
        : [],
      reporterIds.length
        ? this.users.find({
            where: { id: In(reporterIds) },
            select: { id: true, name: true, surname: true, phoneNumber: true },
          })
        : [],
    ]);
    const listingById = new Map(listings.map((l) => [l.id, l] as const));
    const reporterById = new Map(reporters.map((u) => [u.id, u] as const));

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        comment: r.comment,
        status: r.status,
        createdAt: r.createdAt,
        listing: listingById.get(r.listingId)
          ? {
              id: r.listingId,
              title: listingById.get(r.listingId)!.title,
              status: listingById.get(r.listingId)!.status,
              address: listingById.get(r.listingId)!.address,
            }
          : // The listing may have been hard-deleted since; the report keeps
            // its id so the row still tells a story.
            { id: r.listingId, title: null, status: null, address: null },
        reporter: reporterById.get(r.reporterId)
          ? {
              id: r.reporterId,
              name: reporterById.get(r.reporterId)!.name,
              surname: reporterById.get(r.reporterId)!.surname,
              phoneNumber: reporterById.get(r.reporterId)!.phoneNumber,
            }
          : null,
      })),
    };
  }

  async setStatus(id: string, dto: AdminReportStatusDto) {
    const report = await this.reports.findOneBy({ id });
    if (!report) throw new NotFoundException({ code: 'REPORT_NOT_FOUND' });
    await this.reports.update(id, { status: dto.status });
    return { ...report, status: dto.status };
  }

  /** The overview's "needs attention" number. */
  openCount() {
    return this.reports.countBy({ status: 'OPEN' });
  }
}
