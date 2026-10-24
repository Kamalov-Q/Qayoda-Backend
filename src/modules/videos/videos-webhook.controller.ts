import {
  Controller,
  ForbiddenException,
  HttpCode,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiExcludeController } from '@nestjs/swagger';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { BunnyStreamService } from './bunny-stream.service';
import { VideosService } from './videos.service';
import { ListingVideosService } from '../listing-videos/listing-videos.service';
import { BUNNY_WEBHOOK_STATUS } from './videos.constants';

/** The three fields Bunny sends. Everything else in the body is ignored. */
interface BunnyWebhookBody {
  VideoLibraryId?: number;
  VideoGuid?: string;
  Status?: number;
}

/**
 * Bunny Stream's callback: "this video finished encoding" (and the handful of
 * other things it says along the way).
 *
 * Two rules here, both learned from how webhooks actually behave:
 *
 * 1. **Verify, then distrust anyway.** The HMAC header is checked when the
 *    read-only key is configured — but even a valid body is only used as a
 *    hint about *which* video to look at. The duration, the dimensions and
 *    the real status come from a fresh read of Bunny's API, because this
 *    decision spends the author's money and makes a file public.
 * 2. **Always answer 200.** A webhook that errors gets retried, and a retry
 *    storm from a third party is worse than a lost callback — the resync
 *    sweep picks up anything that slipped through within ten minutes.
 */
@ApiExcludeController()
@SkipThrottle()
@Controller('webhooks/bunny-stream')
export class VideosWebhookController {
  private readonly logger = new Logger(VideosWebhookController.name);

  constructor(
    private readonly bunny: BunnyStreamService,
    private readonly videos: VideosService,
    private readonly listingVideos: ListingVideosService,
  ) {}

  @Post()
  @HttpCode(200)
  async handle(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['x-bunnystream-signature'];
    const valid = this.bunny.verifyWebhook(
      req.rawBody,
      typeof signature === 'string' ? signature : undefined,
    );
    if (!valid) {
      this.logger.warn('Rejected a Bunny webhook with a bad signature');
      throw new ForbiddenException('Invalid signature');
    }

    const body = (req.body ?? {}) as BunnyWebhookBody;
    const guid = body.VideoGuid;
    const status = body.Status;
    if (!guid) return { ok: true };

    this.logger.log(`Bunny webhook: ${guid} status=${status}`);

    const interesting =
      status === BUNNY_WEBHOOK_STATUS.FINISHED ||
      status === BUNNY_WEBHOOK_STATUS.RESOLUTION_FINISHED ||
      status === BUNNY_WEBHOOK_STATUS.FAILED ||
      status === BUNNY_WEBHOOK_STATUS.PRESIGNED_UPLOAD_FAILED;
    // The rest (queued, processing, captions generated) are progress reports
    // about a file we are not waiting on yet.
    if (!interesting) return { ok: true };

    try {
      // Bunny has one webhook URL per library, and two features upload into
      // that library. The guid belongs to exactly one of them: the tour
      // service says whether it recognised it, and only if it did not is
      // this a reel. Neither has to know the other exists.
      const wasTour = await this.listingVideos.finalize(guid);
      if (!wasTour) await this.videos.finalize(guid);
    } catch (error) {
      // Swallowed on purpose — see rule 2 in the class comment.
      this.logger.error(
        `Finalizing ${guid} failed: ${(error as Error).message}`,
      );
    }

    return { ok: true };
  }
}
