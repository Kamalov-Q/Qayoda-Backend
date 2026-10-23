import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { VIDEO_UPLOAD_TTL_SEC } from './videos.constants';

/** The fields of a Bunny video object this server actually reads. */
export interface BunnyVideo {
  guid: string;
  /** 0 Created · 1 Uploaded · 2 Processing · 3 Transcoding · 4 Finished · 5 Error · 6 UploadFailed */
  status: number;
  /** Duration in SECONDS, integer. 0 until Bunny has probed the file. */
  length: number;
  width: number;
  height: number;
  /** e.g. `thumbnail.jpg`; Bunny picks the name. */
  thumbnailFileName: string | null;
  /** Comma-separated labels that have finished encoding, e.g. `360p,480p`. */
  availableResolutions: string | null;
  storageSize: number;
  encodeProgress: number;
}

/** What the phone needs to upload straight to Bunny, and nothing more. */
export interface UploadTicket {
  /** The tus endpoint. */
  endpoint: string;
  libraryId: string;
  videoId: string;
  signature: string;
  /** Unix seconds; the signature is only valid until then. */
  expires: number;
}

/**
 * Bunny Stream, as much of it as this app uses.
 *
 * Why a video service at all: transcoding one 60-second clip into three
 * qualities is a minute of CPU, and doing it here would mean the API process
 * competing with ffmpeg for a core while a phone holds 40 MB of request body
 * in its memory. Bunny encodes for free, serves HLS from a CDN, and — the
 * part that matters most — accepts the upload DIRECTLY from the phone, so the
 * bytes never pass through this server at all.
 *
 * The library API key never leaves this process. The phone gets a signature
 * over (libraryId + key + expiry + videoId) instead, which authorises exactly
 * one upload into exactly one video object, and only for the next two hours.
 */
@Injectable()
export class BunnyStreamService {
  private readonly logger = new Logger(BunnyStreamService.name);

  private readonly libraryId = process.env.BUNNY_STREAM_LIBRARY_ID ?? '';
  private readonly apiKey = process.env.BUNNY_STREAM_API_KEY ?? '';
  /**
   * The library's READ-ONLY key: what Bunny signs webhook bodies with. Left
   * unset, webhook signatures are not checked — which is survivable only
   * because every webhook is followed by a fresh read from the API before
   * anything is believed.
   */
  private readonly webhookKey = process.env.BUNNY_STREAM_WEBHOOK_KEY ?? '';
  /** The video library's pull zone, e.g. https://vz-1234abcd.b-cdn.net */
  private readonly cdnUrl = (process.env.BUNNY_STREAM_CDN_URL ?? '').replace(
    /\/+$/,
    '',
  );

  private readonly api = 'https://video.bunnycdn.com';
  private readonly tusEndpoint = 'https://video.bunnycdn.com/tusupload';

  /** False when the env is half-filled, so the feature can refuse politely. */
  get configured(): boolean {
    return !!(this.libraryId && this.apiKey && this.cdnUrl);
  }

  /**
   * Reserve a video object and sign an upload for it.
   *
   * Two steps on purpose: the object has to exist before it can be uploaded
   * into, and its GUID is what both the signature and our own row are keyed
   * on. A ticket that is never used costs nothing — Bunny bills storage, and
   * an empty video object has none.
   */
  async createVideo(title: string): Promise<BunnyVideo> {
    const video = await this.request<BunnyVideo>(
      `/library/${this.libraryId}/videos`,
      { method: 'POST', body: JSON.stringify({ title: title.slice(0, 200) }) },
    );
    return video;
  }

  signUpload(videoId: string): UploadTicket {
    const expires = Math.floor(Date.now() / 1000) + VIDEO_UPLOAD_TTL_SEC;
    // Bunny's formula, byte for byte: SHA256(library_id + api_key + expire + video_id).
    const signature = createHash('sha256')
      .update(`${this.libraryId}${this.apiKey}${expires}${videoId}`)
      .digest('hex');

    return {
      endpoint: this.tusEndpoint,
      libraryId: this.libraryId,
      videoId,
      signature,
      expires,
    };
  }

  getVideo(videoId: string): Promise<BunnyVideo> {
    return this.request<BunnyVideo>(
      `/library/${this.libraryId}/videos/${videoId}`,
    );
  }

  /**
   * Delete the file at Bunny. Never throws: it is called from sweeps and from
   * the failure paths, and a storage object we could not delete is a cent a
   * month, not a reason to fail the request that noticed.
   */
  async deleteVideo(videoId: string): Promise<void> {
    try {
      await this.request(`/library/${this.libraryId}/videos/${videoId}`, {
        method: 'DELETE',
      });
    } catch (error) {
      this.logger.warn(
        `Bunny delete failed for ${videoId}: ${(error as Error).message}`,
      );
    }
  }

  /** HLS manifest. One URL, every quality — the player picks. */
  hlsUrl(videoId: string): string {
    return `${this.cdnUrl}/${videoId}/playlist.m3u8`;
  }

  /**
   * Bunny's own iframe player for this video.
   *
   * Not used by the app, which plays the HLS manifest itself — this is for
   * the dashboard, where a moderator has to watch the clip in a browser.
   * Chrome cannot play an HLS manifest in a `<video>` tag without a
   * JavaScript player, and the embed is the one URL that works everywhere
   * without adding a media library to the admin bundle.
   */
  embedUrl(videoId: string): string | null {
    if (!this.libraryId) return null;
    return `https://iframe.mediadelivery.net/embed/${this.libraryId}/${videoId}`;
  }

  /**
   * The poster frame. Shown instantly while the stream opens, which is most
   * of why the feed feels immediate on a slow connection.
   */
  thumbnailUrl(videoId: string, file: string | null): string | null {
    return file ? `${this.cdnUrl}/${videoId}/${file}` : null;
  }

  /**
   * Whether this webhook body really came from Bunny.
   *
   * HMAC-SHA256 over the RAW body with the read-only key, compared in
   * constant time. The raw bytes matter: parsing and re-serialising the JSON
   * can change them, and then every signature fails.
   */
  verifyWebhook(
    raw: Buffer | undefined,
    signature: string | undefined,
  ): boolean {
    if (!this.webhookKey) return true; // not configured — see the field comment
    if (!raw || !signature) return false;

    const expected = createHmac('sha256', this.webhookKey)
      .update(raw)
      .digest('hex');
    const given = Buffer.from(signature.toLowerCase(), 'utf8');
    const mine = Buffer.from(expected, 'utf8');
    return given.length === mine.length && timingSafeEqual(given, mine);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.api}${path}`, {
      ...init,
      headers: {
        AccessKey: this.apiKey,
        'Content-Type': 'application/json',
        accept: 'application/json',
        ...(init.headers ?? {}),
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.error(
        `Bunny ${init.method ?? 'GET'} ${path}: ${res.status} ${body}`,
      );
      throw new InternalServerErrorException({
        code: 'VIDEO_PROVIDER_ERROR',
        message: 'Video service is unavailable',
      });
    }

    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
