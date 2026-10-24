import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { VideoReport } from './entities/video-report.entity';
import { Video } from './entities/video.entity';
import { VideoComment } from './entities/video-comment.entity';
import { User } from '../users/entities/user.entity';
import { VideoStatus } from './videos.constants';
import { UserRole } from '../../shared/enums';
import { VideosService } from './videos.service';
import {
  AdminVideoReportsQueryDto,
  CreateVideoReportDto,
  ResolveVideoReportDto,
} from './dto/video-report.dto';

const DEFAULT_LIMIT = 25;

/**
 * The moderation queue for videos.
 *
 * Everyone can post — that was the product decision — so this is not an
 * optional extra: without a report button, the first problem video is
 * something the team hears about by telephone. The flow is the listing one,
 * which the dashboard already knows how to render: users flag, admins uphold
 * or dismiss, and upholding can take the video down in the same step.
 */
@Injectable()
export class VideoReportsService {
  private readonly logger = new Logger(VideoReportsService.name);

  constructor(
    @InjectRepository(VideoReport)
    private readonly reports: Repository<VideoReport>,
    @InjectRepository(Video) private readonly videos: Repository<Video>,
    @InjectRepository(VideoComment)
    private readonly comments: Repository<VideoComment>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly videosService: VideosService,
  ) {}

  /**
   * Flag a comment under a reel.
   *
   * The same queue, the same reasons: whoever reviews a video is the person
   * who reviews what is written under it, and splitting them would mean two
   * pages and two sets of buttons for one judgement.
   */
  async createForComment(
    videoId: string,
    commentId: string,
    reporterId: string,
    dto: CreateVideoReportDto,
  ) {
    const comment = await this.comments.findOne({
      where: { id: commentId, videoId },
      select: { id: true, authorId: true },
    });
    if (!comment) throw new NotFoundException('Comment not found');

    if (comment.authorId === reporterId) {
      throw new ForbiddenException({
        code: 'OWN_COMMENT',
        message: 'You cannot report your own comment',
      });
    }

    if (dto.reason === 'OTHER' && !dto.comment) {
      throw new BadRequestException({
        code: 'COMMENT_REQUIRED',
        message: 'A comment is required when the reason is OTHER',
      });
    }

    try {
      await this.reports.insert({
        videoId,
        commentId,
        reporterId,
        reason: dto.reason,
        comment: dto.comment || null,
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: 'ALREADY_REPORTED',
          message: 'You have already reported this comment',
        });
      }
      throw error;
    }

    this.logger.log(
      `Comment ${commentId} reported by ${reporterId}: ${dto.reason}`,
    );
    return { success: true };
  }

  async create(videoId: string, reporterId: string, dto: CreateVideoReportDto) {
    const video = await this.videos.findOne({
      where: { id: videoId },
      select: { id: true, authorId: true, status: true },
    });
    if (!video || video.status !== VideoStatus.READY) {
      throw new NotFoundException('Video not found');
    }

    // Reporting your own video is either a mistake or a way to pad the
    // queue; the author already has a delete button.
    if (video.authorId === reporterId) {
      throw new ForbiddenException({
        code: 'OWN_VIDEO',
        message: 'You cannot report your own video',
      });
    }

    if (dto.reason === 'OTHER' && !dto.comment) {
      throw new BadRequestException({
        code: 'COMMENT_REQUIRED',
        message: 'A comment is required when the reason is OTHER',
      });
    }

    try {
      await this.reports.insert({
        videoId,
        reporterId,
        reason: dto.reason,
        comment: dto.comment || null,
      });
    } catch (error) {
      // The unique constraint is what actually enforces one report per
      // person; this turns the race into the honest answer.
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException({
          code: 'ALREADY_REPORTED',
          message: 'You have already reported this video',
        });
      }
      throw error;
    }

    this.logger.log(
      `Video ${videoId} reported by ${reporterId}: ${dto.reason}`,
    );
    return { success: true };
  }

  /**
   * The dashboard's table: reports hydrated with their video and reporter in
   * two keyed reads rather than joins under take/skip.
   */
  async adminList(query: AdminVideoReportsQueryDto) {
    const [rows, total] = await this.reports.findAndCount({
      where: {
        ...(query.status ? { status: query.status } : {}),
        ...(query.videoId ? { videoId: query.videoId } : {}),
      },
      order: { createdAt: 'DESC' },
      take: query.limit ?? DEFAULT_LIMIT,
      skip: query.offset ?? 0,
    });

    const videoIds = [...new Set(rows.map((r) => r.videoId))];
    const reporterIds = [...new Set(rows.map((r) => r.reporterId))];

    // Typed empties rather than a bare `[]`, which would collapse the Maps
    // below to `Map<any, any>` and quietly stop checking every lookup.
    const [videos, reporters] = await Promise.all([
      videoIds.length
        ? this.videos.find({
            where: { id: In(videoIds) },
            select: {
              id: true,
              authorId: true,
              caption: true,
              status: true,
              listingId: true,
            },
          })
        : Promise.resolve<Video[]>([]),
      reporterIds.length
        ? this.users.find({
            where: { id: In(reporterIds) },
            select: { id: true, name: true, surname: true, phoneNumber: true },
          })
        : Promise.resolve<User[]>([]),
    ]);

    const videoById = new Map(videos.map((v) => [v.id, v] as const));
    const reporterById = new Map(reporters.map((u) => [u.id, u] as const));

    // Only for the rows that are about a comment, which is usually none of
    // them — a moderator needs the words, not another join on every page.
    const commentIds = rows
      .map((r) => r.commentId)
      .filter((id): id is string => !!id);
    const comments = commentIds.length
      ? await this.comments.find({
          where: { id: In(commentIds) },
          select: { id: true, body: true },
        })
      : [];
    const commentById = new Map(comments.map((c) => [c.id, c] as const));

    return {
      total,
      limit: query.limit ?? DEFAULT_LIMIT,
      offset: query.offset ?? 0,
      items: rows.map((r) => {
        const video = videoById.get(r.videoId);
        const reporter = reporterById.get(r.reporterId);

        return {
          id: r.id,
          reason: r.reason,
          comment: r.comment,
          status: r.status,
          resolutionNote: r.resolutionNote,
          createdAt: r.createdAt,
          /** The flagged comment's text, when the report is about one. */
          target: r.commentId
            ? {
                kind: 'COMMENT' as const,
                commentId: r.commentId,
                body: commentById.get(r.commentId)?.body ?? null,
              }
            : { kind: 'VIDEO' as const, commentId: null, body: null },
          video: {
            id: r.videoId,
            authorId: video?.authorId ?? null,
            caption: video?.caption ?? null,
            status: video?.status ?? null,
            listingId: video?.listingId ?? null,
          },
          reporter: reporter
            ? {
                id: reporter.id,
                name: reporter.name,
                surname: reporter.surname,
                phoneNumber: reporter.phoneNumber,
              }
            : null,
        };
      }),
    };
  }

  /**
   * Close a report — and, if it was upheld, take the video down with it.
   *
   * One call rather than two, because the two are the same decision: a
   * moderator who has just watched the clip and agreed with the complaint
   * should not have to find it again in another table to act on it.
   */
  async resolve(id: string, adminId: string, dto: ResolveVideoReportDto) {
    const report = await this.reports.findOneBy({ id });
    if (!report) {
      throw new NotFoundException({ code: 'REPORT_NOT_FOUND' });
    }

    await this.reports.update(id, {
      status: dto.status,
      resolvedBy: adminId,
      resolutionNote: dto.note ?? null,
    });

    if (dto.removeVideo) {
      // Whatever was flagged is what comes down. Upholding a complaint about
      // one comment should never take the whole reel with it.
      if (report.commentId) {
        await this.comments.delete({ id: report.commentId });
      } else {
        await this.videosService.remove(
          report.videoId,
          adminId,
          UserRole.ADMIN,
          dto.note ?? `Report upheld: ${report.reason}`,
        );
      }
    }

    // Every other open complaint about this video is about the same clip, so
    // closing them together is the honest bookkeeping — and it stops the
    // queue filling with decisions that have already been made.
    if (dto.status === 'RESOLVED') {
      await this.reports.update(
        {
          videoId: report.videoId,
          // The same TARGET, not just the same video: closing a complaint
          // about one comment says nothing about a complaint about the clip.
          commentId: report.commentId ?? IsNull(),
          status: 'OPEN',
        },
        {
          status: 'RESOLVED',
          resolvedBy: adminId,
          resolutionNote: dto.note ?? null,
        },
      );
    }

    return { ...report, status: dto.status };
  }

  /** The dashboard overview's "needs attention" number. */
  openCount() {
    return this.reports.countBy({ status: 'OPEN' });
  }
}
