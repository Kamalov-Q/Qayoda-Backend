import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import {
  BunnyStreamService,
  type BunnyVideo,
} from '../videos/bunny-stream.service';
import { BUNNY_VIDEO_STATUS } from '../videos/videos.constants';
import { Listing } from '../listings/entities/listing.entity';
import { ListingVideo } from './entities/listing-video.entity';
import {
  LISTING_VIDEO_ABANDON_HOURS,
  LISTING_VIDEO_DURATION_SLACK_SEC,
  LISTING_VIDEO_MAX_DURATION_SEC,
  LISTING_VIDEO_RESYNC_AFTER_MIN,
  ListingVideoFailReason,
  ListingVideoStatus,
} from './listing-videos.constants';
import type { CreateListingVideoDto } from './dto/listing-video.dto';

/** What a client gets. The Bunny GUID is not a secret — it is in the HLS URL. */
export interface ListingVideoResponse {
  id: string;
  listingId: string;
  status: ListingVideoStatus;
  failReason: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
  /** Null until the file is playable. */
  hlsUrl: string | null;
  thumbUrl: string | null;
  createdAt: string;
}

/**
 * The walkthrough on an advert: upload it, encode it, show it, replace it.
 *
 * Everything money-shaped is absent on purpose. A tour is part of a listing
 * its owner already paid to post, so there is no charge, no AWAITING_PAYMENT,
 * no expiry and no refund question — which is most of why this is not the
 * reels service with a flag.
 */
@Injectable()
export class ListingVideosService {
  private readonly logger = new Logger(ListingVideosService.name);

  constructor(
    @InjectRepository(ListingVideo)
    private readonly videos: Repository<ListingVideo>,
    @InjectRepository(Listing)
    private readonly listings: Repository<Listing>,
    private readonly bunny: BunnyStreamService,
  ) {}

  /**
   * Start an upload, replacing whatever tour the listing had.
   *
   * Replace rather than refuse: "you already have a video, delete it first"
   * is two trips to say no to something the person is allowed to do. The old
   * Bunny object is deleted on the way through, so a listing never holds
   * more than one file.
   */
  async createUploadTicket(
    listingId: string,
    userId: string,
    dto: CreateListingVideoDto,
  ) {
    if (!this.bunny.configured) {
      throw new ServiceUnavailableException({
        code: 'VIDEO_UNAVAILABLE',
        message: 'Video uploads are not configured',
      });
    }

    const listing = await this.mustOwn(listingId, userId);
    await this.discard(listingId);

    const title = `${listing.title ?? 'Listing'} — tour`.slice(0, 80);
    const created = await this.bunny.createVideo(title);

    const video = await this.videos.save(
      this.videos.create({
        listingId: listing.id,
        ownerId: userId,
        providerId: created.guid,
        status: ListingVideoStatus.UPLOADING,
      }),
    );

    this.logger.log(
      `Listing tour ${video.id} (bunny ${created.guid}) for listing ${listing.id}`,
    );

    return {
      videoId: video.id,
      upload: {
        ...this.bunny.signUpload(created.guid),
        /** tus metadata, which Bunny requires both of. */
        metadata: { filetype: dto.mimeType ?? 'video/mp4', title },
      },
    };
  }

  /** The tour as the owner's editor sees it — including one still encoding. */
  async forOwner(
    listingId: string,
    userId: string,
  ): Promise<ListingVideoResponse | null> {
    await this.mustOwn(listingId, userId);
    const video = await this.videos.findOneBy({ listingId });
    return video ? this.shape(video) : null;
  }

  /** Delete the tour and its file. Idempotent: no tour is already the goal. */
  async remove(listingId: string, userId: string) {
    await this.mustOwn(listingId, userId);
    await this.discard(listingId);
    return { success: true };
  }

  /**
   * Bunny has something to say about a file: find out what is true.
   *
   * Same contract as the reels service — the callback body is a hint about
   * WHICH video to look at, and everything that matters is re-read from
   * Bunny's API. Returns false when the guid is not ours, so the one shared
   * webhook can offer it to both features without either having to know
   * about the other.
   */
  async finalize(providerId: string): Promise<boolean> {
    const video = await this.videos.findOneBy({ providerId });
    if (!video) return false;
    if (video.status !== ListingVideoStatus.UPLOADING) return true;

    let remote: BunnyVideo;
    try {
      remote = await this.bunny.getVideo(providerId);
    } catch {
      // Bunny is having a moment. The resync sweep will come back to it.
      return true;
    }

    if (
      remote.status === BUNNY_VIDEO_STATUS.ERROR ||
      remote.status === BUNNY_VIDEO_STATUS.UPLOAD_FAILED
    ) {
      await this.fail(video, ListingVideoFailReason.ENCODING_FAILED);
      return true;
    }

    // Length arrives when Bunny has probed the file, which is before the last
    // resolution finishes. No length yet means there is nothing to decide.
    if (!remote.length || remote.length <= 0) return true;

    if (
      remote.length >
      LISTING_VIDEO_MAX_DURATION_SEC + LISTING_VIDEO_DURATION_SLACK_SEC
    ) {
      this.logger.warn(
        `Listing tour ${video.id} rejected: ${remote.length}s exceeds ${LISTING_VIDEO_MAX_DURATION_SEC}s`,
      );
      await this.fail(video, ListingVideoFailReason.TOO_LONG);
      return true;
    }

    // Playable is enough: Bunny reports one resolution finished well before
    // the whole ladder is done, and the HLS manifest already serves what
    // exists.
    const playable =
      remote.status === BUNNY_VIDEO_STATUS.FINISHED ||
      !!remote.availableResolutions;
    if (!playable) return true;

    await this.videos.update(video.id, {
      status: ListingVideoStatus.READY,
      durationSec: remote.length,
      width: remote.width || null,
      height: remote.height || null,
      thumbnailFile: remote.thumbnailFileName || null,
      hlsUrl: this.bunny.hlsUrl(video.providerId),
      thumbUrl: this.bunny.thumbnailUrl(
        video.providerId,
        remote.thumbnailFileName || null,
      ),
      failReason: null,
      readyAt: new Date(),
    });
    this.logger.log(`Listing tour ${video.id} is ready (${remote.length}s)`);
    return true;
  }

  /**
   * The webhooks that never arrived, and the uploads that never finished.
   *
   * Its own sweep rather than a branch inside the reels one: they run on the
   * same clock but answer to different limits, and a tour has no payment
   * window to expire.
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async sweep(): Promise<void> {
    if (!this.bunny.configured) return;

    const stale = new Date(
      Date.now() - LISTING_VIDEO_RESYNC_AFTER_MIN * 60_000,
    );
    const pending = await this.videos.find({
      where: { status: ListingVideoStatus.UPLOADING, updatedAt: LessThan(stale) },
      take: 50,
    });

    for (const video of pending) {
      const abandoned =
        Date.now() - video.createdAt.getTime() >
        LISTING_VIDEO_ABANDON_HOURS * 3_600_000;
      if (abandoned) {
        await this.fail(video, ListingVideoFailReason.ABANDONED);
        continue;
      }
      try {
        await this.finalize(video.providerId);
      } catch (error) {
        this.logger.error(
          `Resyncing listing tour ${video.id} failed: ${(error as Error).message}`,
        );
      }
    }
  }

  shape(video: ListingVideo): ListingVideoResponse {
    return {
      id: video.id,
      listingId: video.listingId,
      status: video.status,
      failReason: video.failReason,
      durationSec: video.durationSec,
      width: video.width,
      height: video.height,
      hlsUrl: video.hlsUrl,
      thumbUrl: video.thumbUrl,
      createdAt: video.createdAt.toISOString(),
    };
  }

  private async fail(
    video: ListingVideo,
    reason: ListingVideoFailReason,
  ): Promise<void> {
    await this.videos.update(video.id, {
      status: ListingVideoStatus.FAILED,
      failReason: reason,
      hlsUrl: null,
      thumbUrl: null,
    });
    // The bytes are worth nothing now and Bunny bills for storage either way.
    await this.deleteFile(video.providerId);
  }

  /** Drop a listing's tour, row and file, if it has one. */
  private async discard(listingId: string): Promise<void> {
    const existing = await this.videos.findOneBy({ listingId });
    if (!existing) return;
    await this.videos.delete(existing.id);
    await this.deleteFile(existing.providerId);
  }

  private async deleteFile(providerId: string): Promise<void> {
    try {
      await this.bunny.deleteVideo(providerId);
    } catch (error) {
      // An orphaned file costs storage and nothing else; failing the request
      // over it would cost the user their upload.
      this.logger.warn(
        `Could not delete Bunny video ${providerId}: ${(error as Error).message}`,
      );
    }
  }

  private async mustOwn(listingId: string, userId: string): Promise<Listing> {
    const listing = await this.listings.findOne({
      where: { id: listingId },
      select: { id: true, ownerId: true, title: true },
    });
    if (!listing) throw new NotFoundException('Listing not found');
    if (listing.ownerId !== userId) {
      throw new ForbiddenException({
        code: 'NOT_YOUR_LISTING',
        message: 'This is not your listing',
      });
    }
    return listing;
  }
}
