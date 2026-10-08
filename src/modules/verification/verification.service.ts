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
   * they sent, and every place those links are handed out is another place
   * they can leak from — the review queue needs them, this does not.
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

    // Created if they have never written in: the desk may open a thread, and
    // this is the desk opening one.
    const thread = await this.support.adminThreadFor(request.userId);
    const { message } = await this.support.adminSend(thread.id, adminId, {
      body: text,
    });
    this.supportGateway.emitMessage(request.userId, message);

    return { id, status: 'REJECTED' as const, userId: request.userId };
  }

  /**
   * Puts a decided application back in the queue.
   *
   * Moderators are people: one gets approved that should not have been, or
   * turned down on a bad photograph that turns out to be fine. Without this
   * the only way back is to ask the applicant to apply again, which punishes
   * them for somebody else's mistake.
   *
   * Reopening an approved one takes the badge away with it — the account is
   * no longer verified, it is back under review, and leaving the badge on
   * would be saying otherwise. The documents do not come back: they were
   * deleted at the decision and cannot be undeleted, so a reopened
   * application is a request for fresh ones.
   */
  async reopen(id: string, adminId: string) {
    const request = await this.requests.findOneBy({ id });
    if (!request) throw new NotFoundException({ code: 'REQUEST_NOT_FOUND' });

    if (request.status === 'PENDING') {
      throw new BadRequestException({
        code: 'ALREADY_PENDING',
        message: 'This application is already in the queue',
      });
    }

    // The partial unique index allows one PENDING per account; a newer
    // application already waiting is the one the desk should be looking at.
    const waiting = await this.requests.findOneBy({
      userId: request.userId,
      status: 'PENDING',
    });
    if (waiting) {
      throw new BadRequestException({
        code: 'REQUEST_PENDING',
        message: 'A newer application from this account is already waiting',
      });
    }

    if (request.status === 'APPROVED') {
      await this.users.update(request.userId, { isVerifiedRealtor: false });
    }

    await this.requests.update(id, {
      status: 'PENDING',
      reviewerId: adminId,
      reviewedAt: null,
      rejectionReason: null,
    });

    return { id, status: 'PENDING' as const, userId: request.userId };
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
