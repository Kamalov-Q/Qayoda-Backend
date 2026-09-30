import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { MediaFacade } from '../media/media.facade';
import { SupportService } from '../support/support.service';
import { SupportGateway } from '../support/support.gateway';
import { VerificationRequest } from './verification-request.entity';
import {
  AdminVerificationQueryDto,
  SubmitVerificationDto,
} from './dto/verification.dto';

/** A person as the review queue shows them. */
export interface ApplicantCard {
  id: string;
  name: string | null;
  surname: string | null;
  phoneNumber: string | null;
  avatarThumbUrl: string | null;
  isVerifiedRealtor: boolean;
  createdAt: Date;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @InjectRepository(VerificationRequest)
    private readonly requests: Repository<VerificationRequest>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly media: MediaFacade,
    private readonly support: SupportService,
    private readonly supportGateway: SupportGateway,
  ) {}

  // ----------------------------------------------------------------- the user

  /**
   * Where the applicant stands: the badge itself, and their last attempt.
   *
   * The document URLs are deliberately not here. The applicant knows what
   * they sent, and every extra place those links are handed out is another
   * place they can leak from.
   */
  async mine(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, isVerifiedRealtor: true },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });

    const last = await this.requests.findOne({
      where: { userId },
      order: { createdAt: 'DESC' },
    });

    return {
      isVerified: user.isVerifiedRealtor,
      request: last
        ? {
            id: last.id,
            status: last.status,
            rejectionReason: last.rejectionReason,
            createdAt: last.createdAt,
            reviewedAt: last.reviewedAt,
          }
        : null,
    };
  }

  async submit(userId: string, dto: SubmitVerificationDto) {
    const user = await this.users.findOne({
      where: { id: userId },
      select: { id: true, isVerifiedRealtor: true },
    });
    if (!user) throw new NotFoundException({ code: 'USER_NOT_FOUND' });

    if (user.isVerifiedRealtor) {
      throw new BadRequestException({
        code: 'ALREADY_VERIFIED',
        message: 'This account already carries the badge',
      });
    }

    // Checked here as well as by the partial unique index: a caught unique
    // violation is a 500 with a friendly message bolted on, and this is a
    // thing a person can legitimately do twice by tapping twice.
    const pending = await this.requests.findOneBy({ userId, status: 'PENDING' });
    if (pending) {
      throw new BadRequestException({
        code: 'REQUEST_PENDING',
        message: 'An application from this account is already waiting',
      });
    }

    const saved = await this.requests.save(
      this.requests.create({
        userId,
        status: 'PENDING',
        passportFrontUrl: dto.passportFrontUrl,
        passportBackUrl: dto.passportBackUrl,
        selfieUrl: dto.selfieUrl,
      }),
    );

    return {
      id: saved.id,
      status: saved.status,
      createdAt: saved.createdAt,
    };
  }

  // ---------------------------------------------------------------- moderation

  async adminList(q: AdminVerificationQueryDto) {
    const [rows, total] = await this.requests.findAndCount({
      where: q.status ? { status: q.status } : {},
      // Oldest first while they are waiting: a queue worked newest-first
      // leaves its oldest application waiting forever.
      order: { createdAt: q.status === 'PENDING' ? 'ASC' : 'DESC' },
      take: q.limit ?? 20,
      skip: q.offset ?? 0,
    });

    const people = await this.applicants(rows.map((r) => r.userId));

    return {
      total,
      items: rows.map((r) => ({
        id: r.id,
        status: r.status,
        passportFrontUrl: r.passportFrontUrl,
        passportBackUrl: r.passportBackUrl,
        selfieUrl: r.selfieUrl,
        rejectionReason: r.rejectionReason,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt,
        user: people.get(r.userId) ?? null,
      })),
    };
  }

  async approve(id: string, adminId: string) {
    const request = await this.mustBePending(id);

    await this.users.update(request.userId, { isVerifiedRealtor: true });
    await this.requests.update(id, {
      status: 'APPROVED',
      reviewerId: adminId,
      reviewedAt: new Date(),
    });
    await this.purgeDocuments(request);

    return { id, status: 'APPROVED' as const, userId: request.userId };
  }

  /**
   * Turn one down, and say why.
   *
   * The reason is not filed away where only moderators read it — it is sent
   * to the applicant through support, in the thread they already have, so a
   * rejection arrives as a message from a person rather than as a badge that
   * quietly never appeared.
   */
  async reject(id: string, adminId: string, reason: string) {
    const request = await this.mustBePending(id);
    const text = reason.trim();

    await this.requests.update(id, {
      status: 'REJECTED',
      reviewerId: adminId,
      reviewedAt: new Date(),
      rejectionReason: text,
    });
    await this.purgeDocuments(request);

    // Created if they have never written in: the desk may open a thread, and
    // this is the desk opening one.
    const thread = await this.support.adminThreadFor(request.userId);
    const { message } = await this.support.adminSend(thread.id, adminId, {
      body: text,
    });
    this.supportGateway.emitMessage(request.userId, message);

    return { id, status: 'REJECTED' as const, userId: request.userId };
  }

  /** The overview's "needs attention" number. */
  pendingCount() {
    return this.requests.countBy({ status: 'PENDING' });
  }

  // ------------------------------------------------------------------ internals

  private async mustBePending(id: string): Promise<VerificationRequest> {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });

    if (request.status !== 'PENDING') {
      // Two moderators on the same queue is normal; deciding the same
      // application twice is not, and the second one should hear about it
      // rather than silently overwrite the first.
      throw new BadRequestException({
        code: 'ALREADY_REVIEWED',
        message: 'This application has already been decided',
      });
    }
    return request;
  }

  /**
   * The documents go the moment the decision is made.
   *
   * Best effort by design: a storage hiccup must not undo a decision that is
   * already recorded, so a failure here is logged and nothing more. The rows
   * are cleared either way — a URL nobody can produce a file for is no use to
   * anyone who gets hold of it.
   */
  private async purgeDocuments(request: VerificationRequest) {
    const urls = [
      request.passportFrontUrl,
      request.passportBackUrl,
      request.selfieUrl,
    ].filter((u): u is string => !!u);

    await this.requests.update(request.id, {
      passportFrontUrl: null,
      passportBackUrl: null,
      selfieUrl: null,
    });

    const results = await Promise.allSettled(
      urls.map((url) => this.media.deleteFile(url)),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.warn(
          `Verification document not deleted: ${String(result.reason)}`,
        );
      }
    }
  }

  private async applicants(ids: string[]): Promise<Map<string, ApplicantCard>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();

    const rows = await this.users.find({
      where: { id: In(unique) },
      select: {
        id: true,
        name: true,
        surname: true,
        phoneNumber: true,
        avatarThumbUrl: true,
        isVerifiedRealtor: true,
        createdAt: true,
      },
    });
    return new Map(rows.map((u) => [u.id, u as ApplicantCard]));
  }
}
